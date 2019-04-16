'use strict';
require('log-timestamp');
console.log('starting server');
const _ = require('lodash');
const bodyParser = require('body-parser');
const ect = require('ect');
const express = require('express');
const request = require('request');

const config = require('./config.json');
_.defaults(config, {port: 3000});
config.presets = _.chain(config.presets)
	.mapKeys((preset, name) => _.toLower(name))
	.pickBy((preset, name) => {
		if (isValid(preset)) return true;
		console.error('invalid preset: ' + name);
		return false;
	}).value();

const page = ect({root: __dirname}).render('template.ect', {
	presets: _.entries(config.presets)
});

const app = express();
app.use(bodyParser.json());
app.get('*', (req, res) => res.send(page));
_.each(config.presets, (preset, name) => {
	app.post('*/' + name, (req, res) => {
		_.defaults(req.query, preset);
		handle(req, res);
	});
});
app.post('*', handle);
app.listen(config.port);
console.log('listening on port ' + config.port);

function isValid(query) {
	const slack = _.get(query, 'slack');
	if (!_.isString(slack)) return false;
	if (!slack.startsWith('https://hooks.slack.com/services/')) return false;
	return true;
}

function handle(req, res) {
	if (!isValid(req.query)) {
		console.error('bad query: ' + req.query);
		res.sendStatus(400);
		return;
	}
	const payload = generatePayload(req.body, req.query);
	if (_.isEmpty(payload)) {
		res.sendStatus(501);
		return;
	}
	payload.channel = req.query.channel;
	request.post({url: req.query.slack, json: payload}, (err, slackRes, slackBody) => {
		if (err) {
			console.error(err);
			res.sendStatus(500);
			return;
		}
		console.log(slackRes.statusCode);
		res.sendStatus(slackRes.statusCode);
	});
}

function generatePayload(body, query) {
	const dataType = _.get(body, 'dataType');
	if (dataType === 'DiscussionFeedEventBean') {
		const projectId = _.get(body, 'projectId');
		const reviewId = _.get(body, 'data.base.reviewId');
		const userName = _.get(body, 'data.base.actor.userName');
		const commentId = _.get(body, 'data.commentId');
		const commentText = _.get(body, 'data.commentText');
		const baseUrl = `${query.upsource}/${projectId}/review/${reviewId}`;
		console.log('new comment');
		return {
			attachments: [{
				fallback: `[${projectId}/${reviewId}] New comment by ${userName}`,
				pretext: `[<${baseUrl}|${projectId}/${reviewId}>] <${baseUrl}?commentId=${commentId}|New comment> by ${userName}`,
				color: query.color,
				text: commentText,
				mrkdwn_in: ['text']
			}]
		};
	} else if (dataType) console.warn('unknown data type: ' + dataType);
}
