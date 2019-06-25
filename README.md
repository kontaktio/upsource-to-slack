# upsource-to-slack

##To run

###Configure
Set correct values in config.json

###Build image  
```bash
docker build -t kontakt/upsource-to-slack:latest -f deploy/Dockerfile .
```
###Run image
```bash
docker run -d --restart always -p 8050:8080 -w /app kontakt/upsource-to-slack:latest
```
   