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

## Licencias y uso comercial

Charas Studio no concede licencias ni ofrece asesoría legal. Cada sprite conserva los derechos de su autor
y comprobarlos es responsabilidad de quien lo use.

| Set | Licencia | ¿Juego comercial? |
| --- | --- | --- |
| EasyChar (set principal) | CC-BY / CC0 según autor | Sí, incluyendo los créditos |
| Tiny Worlds (EasyChar) | CC0 | Sí |
| Yume Nikki (EasyChar) | KIKIYAMA: licencia desconocida | No recomendado |
| Facesets beta (EasyChar) | Sin licencia definida | No recomendado |
| charas2 (Charas-Project) | Nunca publicó licencia | **No recomendado** |

Por qué charas2 no se recomienda para uso comercial: Charas-Project nunca publicó una licencia para los
sprites, y al menos 592 de las 8.908 piezas nombran en su título o autor un juego comercial o se declaran
rips (Final Fantasy, Breath of Fire, Pokémon, Zelda, Dragon Ball, Sailor Moon, Mega Man…). Muchas otras
son ediciones del RTP de RPG Maker, cuya licencia solo permite usarlo con el RPG Maker correspondiente. La
cifra real es mayor, porque la mayoría de las piezas no indican su origen. Para fan games gratuitos, úsalos
bajo tu propia responsabilidad y da créditos (botón ⓘ en la app).
