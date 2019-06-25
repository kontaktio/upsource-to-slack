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
	console.log(JSON.stringify(body.data));
	console.log(JSON.stringify(payload));
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

const Color = {
	Accept: '#00DB66',
	Concern: '#9879FA',
	Close: '#616161'
};

const kontaktUsers = {
	'a.musial@kontakt.io': '<@U4MCA9PRU>',
	'a.kubera@kontakt.io': '<@U4MCA9PRU>',
	'pawel@kontakt.io': '<@U0UCYTR19>',
	'a.czopek@kontakt.io': '<@UH3DVRV7G>',
	'm.kwiecien@kontakt.io': '<@U0UEBLS23>',
};

const mapKontaktUser = email => kontaktUsers[email] || email;

const Reactions = {
	Accept: [':smiley:', ':smile:', ':simple_smile:', ':satisfied:', ':+1:', ':thumbsup:', ':ok_hand:', ':clap:', ':muscle:', ':v:', ':wave:', ':facepunch:', ':metal:'],
	Concern: [':unamused:', ':pensive:', ':disappointed:', ':no_mouth:', ':grimacing:', ':worried:', ':confused:', ':fearful:', ':fire:', ':thumbsdown:', ':suspect:', ':trollface:'],
	randomAccept: () => Reactions.Accept[_.random(Reactions.Accept.length - 1)],
	randomConcern: () => Reactions.Concern[_.random(Reactions.Accept.length - 1)],
};

const generatePayload = {
	DiscussionFeedEventBean: (body, query) => {
		const data = _.assign(feedEventBean(body, query), {
			commentId: _.get(body, 'data.commentId'),
			commentText: _.get(body, 'data.commentText')
		});

		if (data.commentText.toLocaleLowerCase().trim() === 'done') {
			const path = `/review/${data.reviewId}?commentId=${data.commentId}`;
			const link = data.wrapUrl('New comment', path);
			return {
				attachments: [{
					fallback: `${data.reviewId} is ready for review.`,
					color: `${Color.Accept}`,
					title: `${data.reviewId}`,
					title_link: `${link}`,
					text: `Ready for review ⏳`,
					fields: [
						{
							title: "Author",
							value: mapKontaktUser(data.userEmail),
							short: false
						}
					]
				}]
			};
		}
		return null;
	},
	ReviewCreatedFeedEventBean: (body, query) => {
		const data = _.assign(feedEventBean(body, query), {
			branch: _.get(body, 'data.branch')
		});
		let link = `${data.tagWithLink}`;
		if (!_.isEmpty(data.branch)) {
			const path = `/branch/${data.branch}`;
			link = data.wrapUrl(data.branch, path);
		}
		return {
			attachments: [{
				fallback: `${data.reviewId} created.`,
				color: `${Color.Accept}`,
				title: `${data.reviewId} ${data.branch}`,
				title_link: `${link}`,
				text: `Review created ⏳`,
				fields: [
					{
						title: "Author",
						value: mapKontaktUser(data.userEmail),
						short: false
					}
				]
			}]
		};
	},
	NewParticipantInReviewFeedEventBean: (body, query) => {
		if (body.data.role === 2) {
			const data = feedEventBean(body, query);
			data.reviewer = _.get(body, 'data.participant.userEmail');
			return {
				attachments: [{
					fallback: `${data.reviewId} new participant.`,
					color: `${Color.Accept}`,
					author_name: mapKontaktUser(data.reviewer),
					title: `${data.reviewId}`,
					title_link: `${data.tagWithLink}`,
					text: `Reviewer assigned ${mapKontaktUser(data.reviewer)}`,
					fields: [
						{
							title: "Author",
							value: mapKontaktUser(data.userEmail),
							short: false
						}
					]
				}]
			};
		}
	},
	ReviewStateChangedFeedEventBean: (body, query) => {
		let state, icon, color;
		switch (_.get(body, 'data.newState')) {
			case 0:
				state = 'Reopened';
				icon = ':thinking_face:';
				color = Color.Accept;
				break;
			case 1:
				state = 'Closed';
				icon = '🙂';
				color = Color.Close;
				break;
			default:
				return;
		}
		const data = feedEventBean(body, query);
		return {
			attachments: [{
				fallback: `${data.reviewId} ${state}.`,
				color: `${color}`,
				title: `${data.reviewId}`,
				title_link: `${data.tagWithLink}`,
				text: `Review ${state} ${icon}`,
				fields: [
					{
						title: "Author",
						value: mapKontaktUser(data.userEmail),
						short: false
					}
				]
			}]
		};
	},
	ParticipantStateChangedFeedEventBean: (body, query) => {
		let state, icon, color;
		switch (_.get(body, 'data.newState')) {
			case 2:
				state = 'Changes accepted';
				icon = Reactions.randomAccept();
				color = Color.Accept;
				break;
			case 3:
				state = 'Concern raised';
				icon = Reactions.randomConcern();
				color = Color.Concern;
				break;
			default:
				return;
		}
		const data = feedEventBean(body, query);
		const author =_.get(body, 'data.base.userIds').find(user => user.userEmail !== data.userEmail);
		data.author = author && author.userEmail;
		return {
			attachments: [{
				fallback: `${data.reviewId} ${state}.`,
				color: `${color}`,
				author_name: mapKontaktUser(data.userEmail),
				title: `${data.reviewId}`,
				title_link: `${data.tagWithLink}`,
				text: `${state} ${icon}`,
				fields: [
					{
						title: "Author",
						value: mapKontaktUser(data.author),
						short: false
					}
				]
			}]
		};
	},
	RevisionAddedToReviewFeedEventBean: (body, query) => {
		let fallback, pretext;
		const length = _.get(body, 'data.revisionIds.length');
		if (length > 0) {
			const data = feedEventBean(body, query);
			fallback = data.tag;
			pretext = data.tagWithLink;
			addToBoth(` ${length} commit`);
			if (length > 1) addToBoth('s');
			addToBoth(` added to review by ${data.userName}`);
			const text = _.chain(body.data.revisionIds).map(id => {
				const label = `\`${id.substr(0, 7)}\``;
				return data.wrapUrl(label, `/revision/${id}`);
			}).join('\n').value();
			return {
				attachments: [{
					fallback: fallback,
					pretext: pretext,
					text: text,
					mrkdwn_in: ['text']
				}]
			};
		}

		function addToBoth(str) {
			fallback += str;
			pretext += str;
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
		data.wrapUrl = (text, path) => `${data.baseUrl}${path}`;
	}
	data.tag = `[${data.projectId} #${data.reviewNumber}]`;
	data.tagWithLink = data.wrapUrl(data.tag, `/review/${data.reviewId}`);
	return data;
}
