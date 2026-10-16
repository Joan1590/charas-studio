.PHONY: up down scrape easychar data build test

up:            ## Serve the app on http://localhost:$${WEB_PORT:-8093}
	docker compose up -d web

down:
	docker compose down

scrape:        ## Mirror all Charas-Project sprites (resumable)
	docker compose run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp scraper python scrape_charas.py

easychar:      ## Extract EasyChar PSD layers
	docker compose run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp scraper python extract_easychar.py

data: scrape easychar

build:         ## Production image (static nginx)
	docker build -t charas-studio .

test:
	docker run --rm -v "$$PWD:/app:ro" -w /app node:22-alpine node --test tests/*.test.mjs
	docker compose run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp scraper python test_scrape.py
