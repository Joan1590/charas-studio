"""Extract EasyChar (jetrotal.github.io/EasyChar) PSD layers into ../public.

Each top-level PSD group is a z-slot; groups sharing a name form one menu
category (EasyChar draws the same index from every group of that type).

Writes:
  /public/sprites/easychar/<psd>/<slot>/[<variant>/]<n>.png  full-canvas parts
  /public/data/easychar/<psd>.json                          set catalog
  /public/data/easychar/index.json
"""
import json
import logging
import os
import urllib.request

from PIL import Image
from psd_tools import PSDImage

SRC = "https://jetrotal.github.io/EasyChar/"
OUT = os.environ.get("OUT_DIR", "/public")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "easychar")

# psd name -> (label, cell grid cols x rows)
PSDS = {
    "spriteData": ("EasyChar", (3, 4)),
    "YN": ("Yume Nikki", (3, 4)),
    "tinyWorlds": ("Tiny Worlds", (5, 20)),
    "Facesets": ("Facesets (beta)", (1, 1)),
}

# EasyChar's params.default (show / recolor per category); others: show, no recolor
DEFAULTS = {
    "clothes": {"show": False}, "clothes-b": {"show": False},
    "hair-xtra": {"show": False, "recolor": True}, "xtra-body": {"show": False},
    "xtra-head": {"show": False}, "hair-back": {"recolor": True},
    "hair-front": {"recolor": True}, "eyes-pupil": {"recolor": True},
    "bg-color": {"show": False},
}

# Port of spriteData's @functions changeYposition (first match wins)
SPRITEDATA_RULES = {
    "bodyCat": "body-type",
    "yshift": [
        {"v": "adult", "body": [1, 9], "cats": ["clothes"], "dy": -2},
        {"v": "adult", "body": [1, 2, 9], "cats": ["clothes-b"], "dy": -2},
        {"v": "adult", "body": [2], "cats": ["clothes"], "dy": -1},
        {"v": "child", "notRe": "body|clothes|bg-color", "dy": 2},
        {"v": "child", "cats": ["xtra-body"], "dy": 1},
    ],
    "autoShow": {"body-fix": {"v": "adult", "body": [1], "visible": "clothes", "recolorFrom": "body-type"}},
}

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("easychar")


def psd_path(name):
    path = os.path.join(CACHE, f"{name}.psd")
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        urllib.request.urlretrieve(SRC + f"{name}.psd", path)
    return path


def sort_key(n):
    return (0, int(n)) if n.isdigit() else (1, n)


def save_part(layer, size, path):
    """Paste a layer's raw pixels on a full transparent canvas (like psd.js toPng + x/y)."""
    im = layer.topil()
    if im is None or layer.width == 0 or layer.height == 0:
        return False
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.paste(im.convert("RGBA"), (layer.left, layer.top))
    if canvas.getbbox() is None:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path, "PNG", optimize=True)
    return True


def parse_rules(group):
    rules, credits = {"variants": None, "noMenu": [], "remap": {}}, ""
    for child in group:
        if child.kind == "type":
            credits = child.text.replace("\r", "\n").strip()
        else:
            rules.update(json.loads(child.name))
    return rules, credits


def extract(name, label, grid):
    psd = PSDImage.open(psd_path(name))
    size = psd.size
    rules, credits = {"variants": None, "noMenu": [], "remap": {}}, ""
    slots, parts = [], {}  # parts[(slot, variant)] = {index: path}
    for top in psd:
        if top.name == "@rules":
            rules, credits = parse_rules(top)
            continue
        if top.name.startswith("@"):
            continue
        k = len(slots)
        slots.append(top.name)
        for child in top:
            variant = child.name if child.is_group() else None
            for layer in (child if child.is_group() else [child]):
                n = layer.name.strip()
                if layer.is_group() or n == "0":
                    continue  # '0' is EasyChar's 1px placeholder
                rel = f"sprites/easychar/{name}/{k}/{variant + '/' if variant else ''}{n}.png"
                if save_part(layer, size, os.path.join(OUT, rel)):
                    parts.setdefault((k, variant), {})[n] = rel

    variants = rules.get("variants") or []
    has_variant_menu = "variantsMenu" not in rules.get("noMenu", []) and any(v for _, v in parts)
    categories = []
    for cat in dict.fromkeys(slots):
        cat_slots = [k for k, s in enumerate(slots) if s == cat]
        cat_variants = [v for v in variants if any((k, v) in parts for k in cat_slots)]

        def items_for(v):
            names = sorted({n for k in cat_slots for n in parts.get((k, v), {})}, key=sort_key)
            return [{"id": n, "t": f"{cat} {n}", "src": [parts.get((k, v), {}).get(n) for k in cat_slots]} for n in names]

        entry = {"id": cat, "name": cat, "slots": cat_slots, **{"show": True, "recolor": False}, **DEFAULTS.get(cat, {})}
        if cat in rules.get("noMenu", []):
            entry["menu"] = False
        if cat_variants:
            entry["variants"] = {v: items_for(v) for v in cat_variants}
        else:
            entry["items"] = items_for(None)
        categories.append(entry)

    # EasyChar menu order: alphabetical, 'head' first, 'bg-color' last
    categories.sort(key=lambda c: (c["id"] != "head", c["id"] == "bg-color", c["id"].lower()))
    data = {
        "w": size[0], "h": size[1], "grid": list(grid), "base": "", "slotCount": len(slots),
        "categories": categories, "credits": credits,
        "variants": variants if has_variant_menu else None,
        "defaultVariant": variants[1] if len(variants) > 1 else None,
        "remap": rules.get("remap", {}),
    }
    if name == "spriteData":
        data.update(SPRITEDATA_RULES)
    with open(os.path.join(OUT, "data", "easychar", f"{name}.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    psd.composite().save(os.path.join(CACHE, f"{name}_composite.png"))
    log.info("%s: %dx%d, %d slots, %d categories, %d parts", name, *size, len(slots), len(categories), sum(map(len, parts.values())))
    return {"id": name, "name": label, "file": f"data/easychar/{name}.json", "count": sum(map(len, parts.values()))}


def main():
    os.makedirs(os.path.join(OUT, "data", "easychar"), exist_ok=True)
    sets = [extract(n, label, grid) for n, (label, grid) in PSDS.items()]
    index = [{"id": "easychar", "name": "EasyChar", "source": "easychar", "sets": sets}]
    with open(os.path.join(OUT, "data", "easychar", "index.json"), "w") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main()
