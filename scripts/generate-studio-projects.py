import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
STUDIO = ROOT / "assets" / "studio"
IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg"}


def natural_key(value):
    return [(1, int(part)) if part.isdigit() else (0, part.casefold()) for part in re.split(r"(\d+)", value)]


def asset_path(path):
    return quote(path.relative_to(ROOT).as_posix(), safe="/")


def discover():
    projects = []
    if not STUDIO.is_dir():
        return projects
    for folder in sorted((item for item in STUDIO.iterdir() if item.is_dir()), key=lambda item: natural_key(item.name)):
        files = [item for item in folder.iterdir() if item.is_file()]
        images = sorted((item for item in files if item.suffix.casefold() in IMAGE_EXTENSIONS), key=lambda item: natural_key(item.name))
        models = sorted((item for item in files if item.suffix.casefold() == ".glb"), key=lambda item: natural_key(item.name))
        archives = sorted((item for item in files if item.suffix.casefold() in (".zip", ".rar")), key=lambda item: natural_key(item.name))
        if len(images) not in (4, 5) or len(models) != 2 or not archives:
            continue
        project_id = re.sub(r"[^a-z0-9]+", "-", folder.name.casefold()).strip("-") or "studio-project"
        projects.append({
            "id": project_id,
            "title": folder.name,
            "model": asset_path(models[0]),
            "visibleModel": asset_path(models[1]),
            "images": [asset_path(image) for image in images],
            "downloadArchive": asset_path(archives[0]) if archives else "",
        })
    return projects


if __name__ == "__main__":
    output = ROOT / "studio-projects.json"
    output.write_text(json.dumps(discover(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Discovered {len(discover())} studio project(s).")
