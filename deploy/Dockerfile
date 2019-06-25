FROM node:12-slim
RUN mkdir /app
ADD index.js /app
ADD config.json /app
ADD template.ect /app
ADD package.json /app
WORKDIR /app
RUN npm install
CMD node index.js
