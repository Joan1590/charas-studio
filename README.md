# Charas Studio

Clon estático de Charas-Project (charas2) con el motor de
[EasyChar](https://jetrotal.github.io/EasyChar/) (capas, recolor por degradado, lápiz/borrador, export PNG).

- 8 908 sprites de charas2: Charasets (10 sets), Facesets (5), Battlechar (2).
- 4 sets de EasyChar: EasyChar (child/adult), Yume Nikki, Tiny Worlds, Facesets (beta).
- Hoja RPG Maker 2000/2003: 8 personajes en 288×256 (o 16 caras en 192×192), exportada como PNG de
  256 colores con el índice 0 transparente. También carga hojas existentes (PNG/BMP).
- 10 idiomas (es, en, pt, fr, it, de, nl, sv, da, ru), como el charas2 original: selector, `?lang=xx` y `hreflang`.
- Créditos: los del personaje actual y los completos de charas2 (generador, Charas.EX, documentación
  y los 412 autores de sprites, en `data/charas/credits.json`).

## Uso

```bash
make up        # http://localhost:8093
make data      # re-descarga charas2 (reanudable) + extrae los PSD de EasyChar
make test
make build     # imagen nginx de producción
```

## Publicar en GitHub Pages

1. Sube el repo a GitHub (rama `main`).
2. En el repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cada push a `main` ejecuta `.github/workflows/pages.yml`: tests, ajusta las URLs de SEO a la URL real
   de Pages y despliega `public/`. Si el primer despliegue falló por no tener Pages activado, relánzalo
   desde **Actions → Deploy GitHub Pages → Run workflow**.
4. SEO: añade la URL en [Google Search Console](https://search.google.com/search-console) (propiedad
   por prefijo de URL) y envía `sitemap.xml`; igual en Bing Webmaster Tools.

## Estructura

- `public/` — la app (HTML/CSS/JS sin build) + `data/*.json` + `sprites/`; textos en `public/i18n.js`.
- `scraper/scrape_charas.py` — espejo de charas2 (`res_viewer.php`, fondo verde → transparente).
- `scraper/extract_easychar.py` — PSD → PNG por capa; reglas de `@functions` portadas a JSON.

Créditos: sprites de charas2 por sus autores (ver ⓘ en la app); assets de EasyChar bajo las
licencias CC indicadas en el diálogo de créditos.
