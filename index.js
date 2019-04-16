'use strict';
require('log-timestamp');
const _ = require('lodash');
const bodyParser = require('body-parser');
const express = require('express');
const request = require('request');

const config = {
	port: 3000,
	slack: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
	upsource: 'http://upsource.server',
	color: '#fe8202'
};

const app = express();
app.use(bodyParser.json());
app.get('*', (req, res) => {
	res.sendFile('index.html', {root: 'www'},
		err => err && res.sendStatus(404));
});
app.post('*', (req, res) => {
	const payload = upsourceToSlack(req.body);
	if (payload) {
		request.post({url: config.slack, json: payload});
	}
	res.end();
});
app.listen(config.port);
console.log('listening on port ' + config.port);

function upsourceToSlack(body) {
	const dataType = _.get(body, 'dataType');
	if (dataType === 'DiscussionFeedEventBean') {
		const projectId = _.get(body, 'projectId');
		const reviewId = _.get(body, 'data.base.reviewId');
		const userName = _.get(body, 'data.base.actor.userName');
		const commentId = _.get(body, 'data.commentId');
		const commentText = _.get(body, 'data.commentText');
		const baseUrl = `${config.upsource}/${projectId}/review/${reviewId}`;
		console.log('new comment');
		return {
			attachments: [{
				fallback: `[${projectId}/${reviewId}] New comment by ${userName}`,
				pretext: `[<${baseUrl}|${projectId}/${reviewId}>] <${baseUrl}?commentId=${commentId}|New comment> by ${userName}`,
				color: config.color,
				text: commentText,
				mrkdwn_in: ['text']
			}]
		};
	} else if (dataType) console.warn('unknown data type: ' + dataType);
}
