"""Importa o HTML indicado pela cliente sem redesenhar seus elementos."""
from pathlib import Path
import base64, hashlib, re, shutil, json, sys

root = Path(__file__).resolve().parent.parent
archive = root / 'references' / 'loja'
archive.mkdir(parents=True, exist_ok=True)
archived = archive / 'Juliana-Souza-Atualizacao-Original-3.html'
source = Path(sys.argv[1]) if len(sys.argv) > 1 else archived
if not source.is_file():
    raise FileNotFoundError('Informe o caminho do HTML original ou preserve a referência em references/loja.')
if source.resolve() != archived.resolve():
    shutil.copy2(source, archived)
html = source.read_text(encoding='utf-8-sig')
assets = root / 'apps/loja/public/brand/html-original'
assets.mkdir(parents=True, exist_ok=True)
def extract(match):
    mime, data = match.groups()
    raw = base64.b64decode(data)
    extension = {'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'font/ttf': 'ttf', 'font/woff2': 'woff2'}.get(mime)
    if not extension:
        raise ValueError('Tipo incorporado não esperado: ' + mime)
    name = hashlib.sha256(raw).hexdigest()[:24] + '.' + extension
    (assets / name).write_bytes(raw)
    return '/brand/html-original/' + name
html = re.sub(r'data:([^;,]+);base64,([A-Za-z0-9+/=]+)', extract, html)
mapping = json.loads(re.search(r'const ASSETS=(\{.*?\});', html, re.S).group(1))
lib = root / 'apps/loja/lib'
lib.mkdir(exist_ok=True)
(lib / 'original-assets.ts').write_text('export const originalLogo = ' + json.dumps(mapping['logo-juliana-souza.webp']) + ';\n', encoding='utf-8')
css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', html, re.S))
(root / 'apps/loja/app/original-html.css').write_text(css, encoding='utf-8')
html = html.replace('</body>', '<script src="/original-storefront-bridge.js" defer></script></body>')
(root / 'apps/loja/public/original-storefront.html').write_text(html, encoding='utf-8')
print('HTML original importado; imagens, fontes, estilos e scripts preservados.')
