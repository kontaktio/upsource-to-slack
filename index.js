'use strict';
require('log-timestamp');
console.log('starting server');
const _ = require('lodash');
const bodyParser = require('body-parser');
const ect = require('ect');
const express = require('express');
const request = require('request');
const url = require('url');

const config = require('./config.json');
_.defaults(config, {port: 3000});
config.presets = _.chain(config.presets)
	.mapKeys((preset, name) => _.toLower(name))
	.pickBy((preset, name) => isValid(preset) || console.error('invalid preset: ' + name))
	.value();

const app = express();
app.use(bodyParser.json());
const render = _.partial(ect({root: __dirname}).render, 'template.ect');
const entries = _.entries(config.presets);
_.each(config.presets, (preset, name) => {
	const page = render({current: preset, presets: entries});
	app.get('*/' + name, (req, res) => res.send(page));
	app.post('*/' + name, (req, res) => {
		console.log('use preset: ' + name);
		const skip = _.isEmpty(req.query);
		_.defaults(req.query, preset);
		handle(req, res, skip);
	});
});
const page = render({presets: entries});
app.get('*', (req, res) => res.send(page));
app.post('*', (req, res) => handle(req, res));
app.listen(config.port);
console.log('listening on port ' + config.port);

function isValid(query) {
	const slack = _.get(query, 'slack');
	if (!_.isString(slack)) return false;
	if (!slack.startsWith('https://hooks.slack.com/services/')) return false;
	return true;
}

function handle(req, res, skipValidate) {
	const {body, query} = req;
	if (!skipValidate && !isValid(query)) {
		console.error('bad query:');
		console.error(query);
		res.sendStatus(400);
		return;
	}
	const dataType = _.get(body, 'dataType');
	const payload = _.invoke(generatePayload, dataType, body, query);
	if (_.isEmpty(payload)) {
		console.warn('unknown data type: ' + dataType);
		console.warn(body.data);
		res.sendStatus(501);
		return;
	}
	console.log(dataType);
	console.log(body.data);
	if (!_.isEmpty(query.channel)) payload.channel = query.channel;
	request.post({url: query.slack, json: payload}, (err, slackRes, slackBody) => {
		if (err) {
			console.error(err);
			res.sendStatus(500);
			return;
		}
		console.log(`${slackRes.statusCode} ${slackBody}`);
		res.status(slackRes.statusCode).send(slackBody);
	});
}

const generatePayload = {
	DiscussionFeedEventBean: (body, query) => {
		const data = _.assign(feedEventBean(body, query), {
			commentId: _.get(body, 'data.commentId'),
			commentText: _.get(body, 'data.commentText')
		});
		const path = `/review/${data.reviewId}?commentId=${data.commentId}`;
		const link = data.wrapUrl('New comment', path);
		return {
			attachments: [{
				fallback: `${data.tag} New comment by ${data.userName}`,
				pretext: `${data.tagWithLink} ${link} by ${data.userName}`,
				text: data.commentText,
				mrkdwn_in: ['text']
			}]
		};
	},
	ParticipantStateChangedFeedEventBean: (body, query) => {
		let state;
		switch (_.get(body, 'data.newState')) {
			case 2:
				state = 'Changes accepted';
				break;
			case 3:
				state = 'Concern raised';
				break;
			default:
				return;
		}
		const data = feedEventBean(body, query);
		return {text: `${data.tagWithLink} ${state} by ${data.userName}`};
	},
	ReviewCreatedFeedEventBean: (body, query) => {
		const data = _.assign(feedEventBean(body, query), {
			branch: _.get(body, 'data.branch')
		});
		let text = `${data.tagWithLink} Review created by ${data.userName}`;
		if (!_.isEmpty(data.branch)) {
			const path = `/branch/${data.branch}`;
			const link = data.wrapUrl(data.branch, path);
			text += ` on branch ${link}`;
		}
		return {text: text};
	},
	ReviewStateChangedFeedEventBean: (body, query) => {
		let state;
		switch (_.get(body, 'data.newState')) {
			case 0:
				state = 'reopened';
				break;
			case 1:
				state = 'closed';
				break;
			default:
				return;
		}
		const data = feedEventBean(body, query);
		return {text: `${data.tagWithLink} Review ${state} by ${data.userName}`};
	},
	RevisionAddedToReviewFeedEventBean: (body, query) => {
		const length = _.get(body, 'data.revisionIds.length');
		if (length > 0) {
			const data = feedEventBean(body, query);
			let text = `${data.tagWithLink} ${length} commit`;
			if (length > 1) text += 's';
			text += ` added to review by ${data.userName}`;
			return {text: text};
		}
	}
};

function feedEventBean(body, query) {
	const data = {
		projectId: _.get(body, 'projectId'),
		reviewId: _.get(body, 'data.base.reviewId'),
		reviewNumber: _.get(body, 'data.base.reviewNumber'),
		userName: _.get(body, 'data.base.actor.userName'),
		userEmail: _.get(body, 'data.base.actor.userEmail')
	};
	if (_.isEmpty(query.upsource)) {
		data.wrapUrl = (text) => text;
	} else {
		data.baseUrl = url.resolve(query.upsource, data.projectId);
		data.wrapUrl = (text, path) => `<${data.baseUrl}${path}|${text}>`;
	}
	data.tag = `[${data.projectId} #${data.reviewNumber}]`;
	data.tagWithLink = data.wrapUrl(data.tag, `/review/${data.reviewId}`);
	return data;
}
