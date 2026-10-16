"""Mirror every sprite of charas-project.net/charas2 into ../public.

Writes:
  /public/sprites/charas/<id>.png        transparent full sheets
  /public/data/charas/<gen>-<set>.json   catalog per size set
  /public/data/charas/index.json         list of generators / size sets

Resumable: listings are cached in ./cache/charas, existing PNGs are skipped.
"""
import html
import io
import json
import logging
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

BASE = os.environ.get("CHARAS_BASE", "http://www.charas-project.net/charas2/")
OUT = os.environ.get("OUT_DIR", "/public")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "charas")
WORKERS = int(os.environ.get("WORKERS", "6"))
KEY = (32, 156, 0)  # charas background color key
FRAMES = "_".join("t" * 12)
GENERATORS = {1: "Charasets", 2: "Facesets", 3: "Battlechar"}
# Cell grid (cols, rows) of each generator's sheet
GRIDS = {1: (3, 4), 2: (1, 1), 3: (6, 8)}

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("charas")


def fetch(url, binary=False, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "charas2-clone-archiver/1.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            return data if binary else data.decode("latin-1")
        except Exception as e:  # network errors are retried, then re-raised
            if attempt == tries - 1:
                raise
            log.warning("retry %s (%s)", url, e)
            time.sleep(2 ** attempt)


def cached_page(name, url):
    path = os.path.join(CACHE, "pages", name + ".html")
    if os.path.exists(path):
        with open(path, encoding="latin-1") as f:
            return f.read()
    text = fetch(url)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="latin-1") as f:
        f.write(text)
    return text


def split_title(raw):
    raw = html.unescape(raw).strip()
    title, _, author = raw.rpartition(", by ")
    return (title, author) if title else (raw, "")


IMG_RE = re.compile(r"<img src='viewer\.php\?[^']*img=(\d+)' title='([^']*)'")
POP_RE = re.compile(r"poporiginale\('([^']*)'\)")


def parse_items(fragment):
    return [{"id": int(i), "t": t, "a": a} for i, raw in IMG_RE.findall(fragment) for t, a in [split_title(raw)]]


def scrape_listing(gen, sset, cat):
    q = f"innerleft={cat}&defview=2&lang=en&base_sizeset={sset}&base_sideset=1&generator={gen}"
    page = cached_page(f"l-{gen}-{sset}-{cat}", BASE + "charas_l.php?" + q)
    slots = max([1] + [int(n) for n in re.findall(rf"innerleft={cat}&layer=(\d+)", page)])
    groups = []
    for cell in page.split("<td valign='top'")[1:]:
        pop = POP_RE.search(cell)
        if not pop:
            groups.extend(parse_items(cell))
            continue
        params = pop.group(1)
        gid = re.search(r"id=(\d+)", params).group(1)
        variants = parse_items(cached_page(f"o-{gen}-{sset}-{cat}-{gid}", BASE + "originale.php?" + params))
        head = next((v for v in variants if v["id"] == int(gid)), None) or parse_items(cell)[0]
        rest = [v for v in variants if v["id"] != head["id"]]
        groups.append({**head, "alts": rest} if rest else head)
    return slots, groups


def scrape_generator(gen):
    page = cached_page(f"g-{gen}", BASE + f"charas_l.php?lang=en&generator={gen}&defview=2")
    sel = re.search(r"<select name='base_sizeset'.*?</select>", page, re.S).group(0)
    sets = [(int(v), html.unescape(n).strip()) for v, n in re.findall(r"<option value='(\d+)'[^>]*>([^<]+)", sel)]
    cats = []
    for cid, name in re.findall(rf"innerleft=(\d+)&defview=2&lang=en&base_sizeset=\d+&base_sideset=\d+&generator={gen}'>(?:<span[^>]*>)?([^<]+)", page):
        name = html.unescape(name).strip()
        if int(cid) not in [c for c, _ in cats]:
            dupes = sum(1 for _, n in cats if n == name)
            cats.append((int(cid), f"{name} {dupes + 1}" if dupes else name))
    log.info("generator %s: %d sets, categories %s", GENERATORS[gen], len(sets), cats)
    return sets, cats


SK = {"value": None}


def refresh_sk():
    page = fetch(BASE + f"charas_r.php?checkurls=1&lang=en&new=115_1_{100}_{FRAMES}&newtext=")
    SK["value"] = re.search(r"sk=(\d+)", page).group(1)
    log.info("session key %s", SK["value"])


def download(img_id):
    path = os.path.join(OUT, "sprites", "charas", f"{img_id}.png")
    if os.path.exists(path):
        return path
    for attempt in range(3):
        url = BASE + f"res_viewer.php?sk={SK['value']}&img={img_id}_1_100_{FRAMES}&texts="
        data = fetch(url, binary=True)
        if data:
            break
        refresh_sk()  # empty body means the daily key expired
    else:
        log.error("no image for id %s", img_id)
        return None
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    px = [(0, 0, 0, 0) if p[:3] == KEY else p for p in im.getdata()]
    im.putdata(px)
    tmp = path + ".tmp"
    im.save(tmp, "PNG", optimize=True)
    os.replace(tmp, path)
    return path


def all_ids(groups):
    for g in groups:
        yield g["id"]
        for a in g.get("alts", []):
            yield a["id"]


# Fixed credits published on charas-project.net (footer, charas_ex.php, docs.php)
SITE_CREDITS = {  # labels are translated by the app
    "generator": "Charas Generator 2.1 — © 2002-2026 Alexander Bonivento — http://charas-project.net",
    "offline": "GPI",  # Charas.EX, the official offline version
    "docs": "SMB, Giovy LoCa, GaryCXJk",
}


def write_credits():
    """Aggregate every sprite author from the written catalogs into data/charas/credits.json."""
    with open(os.path.join(OUT, "data", "charas", "index.json")) as f:
        index = json.load(f)
    authors, seen = {}, set()
    for gen in index:
        for s in gen["sets"]:
            with open(os.path.join(OUT, s["file"])) as f:
                cats = json.load(f)["categories"]
            for g in (g for c in cats for g in c.get("items", [])):
                for it in [g, *g.get("alts", [])]:
                    name = it["a"].strip()
                    if name and it["id"] not in seen:
                        authors[name] = authors.get(name, 0) + 1
                    seen.add(it["id"])
    ranked = sorted(authors.items(), key=lambda a: (-a[1], a[0].lower()))
    with open(os.path.join(OUT, "data", "charas", "credits.json"), "w") as f:
        json.dump({"site": SITE_CREDITS, "sprites": len(seen), "authors": ranked}, f, ensure_ascii=False, separators=(",", ":"))
    log.info("credits: %d authors, %d sprites", len(ranked), len(seen))


def main():
    if sys.argv[1:] == ["--credits"]:
        return write_credits()
    os.makedirs(os.path.join(OUT, "sprites", "charas"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "data", "charas"), exist_ok=True)
    only = [int(g) for g in sys.argv[1:]] or list(GENERATORS)
    refresh_sk()
    index_path = os.path.join(OUT, "data", "charas", "index.json")
    index = []
    if os.path.exists(index_path):
        with open(index_path) as f:
            index = [g for g in json.load(f) if int(g["id"].split("-")[1]) not in only]
    for gen in only:
        sets, cats = scrape_generator(gen)
        gen_entry = {"id": f"charas-{gen}", "name": GENERATORS[gen], "source": "charas", "sets": []}
        for sset, sname in sets:
            categories, ids = [], []
            with ThreadPoolExecutor(WORKERS) as pool:
                results = list(pool.map(lambda c: scrape_listing(gen, sset, c[0]), cats))
            for (cid, cname), (slots, groups) in zip(cats, results):
                if not groups:
                    continue
                ids.extend(all_ids(groups))
                first = f"c{cid}"
                categories.append({"id": first, "name": cname, "items": groups})
                for n in range(2, slots + 1):
                    categories.append({"id": f"c{cid}-{n}", "name": f"{cname} {n}", "itemsRef": first})
            ids = list(dict.fromkeys(ids))
            if not ids:
                log.warning("set %s/%s is empty, skipped", gen, sname)
                continue
            log.info("set %s/%s: %d sprites", GENERATORS[gen], sname, len(ids))
            with ThreadPoolExecutor(WORKERS) as pool:
                paths = [p for p in pool.map(download, ids) if p]
            w, h = Image.open(paths[0]).size
            cols, rows = GRIDS[gen]
            set_id = f"{gen}-{sset}"
            with open(os.path.join(OUT, "data", "charas", f"{set_id}.json"), "w") as f:
                json.dump({"w": w, "h": h, "grid": [cols, rows], "base": "sprites/charas/", "categories": categories}, f, separators=(",", ":"))
            gen_entry["sets"].append({"id": set_id, "name": sname, "file": f"data/charas/{set_id}.json", "count": len(ids)})
        index.append(gen_entry)
        index.sort(key=lambda g: g["id"])
        with open(index_path, "w") as f:
            json.dump(index, f, indent=1)
    write_credits()
    log.info("done")


if __name__ == "__main__":
    main()
