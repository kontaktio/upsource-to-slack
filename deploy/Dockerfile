FROM node:13.6-alpine as builder

ADD package.json .
RUN npm install

FROM node:13.6-alpine as app

## Copy built node modules and binaries without including the toolchain
COPY --from=builder node_modules .

RUN mkdir /app
ADD index.js config.json template.ect /app/
WORKDIR /app

CMD node index.js
