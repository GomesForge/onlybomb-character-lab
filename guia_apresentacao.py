"""Keep exact original guide + one user-requested navigation enhancement."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent
TAG=b'<script type="module" src="./navigation.js"></script>'
def verify(path):
    raw=Path(path).read_bytes()
    assert raw.count(TAG)==1,'Navigation addition missing/duplicated'
    original=raw.replace(TAG,b'')
    meta=json.loads((ROOT/'ORIGEM_GUIA.json').read_text(encoding='utf8'))
    assert hashlib.sha256(original).hexdigest()==meta['sha256'],'Original guide content changed'
    return original
def update():
    source=ROOT.parent/'39_GUIA_CRIACAO_PERSONAGENS/GUIA_CRIACAO_PERSONAGENS.html'
    raw=source.read_bytes();assert b'</body>' in raw
    target=ROOT/'web/guia/index.html'
    target.write_bytes(raw.replace(b'</body>',TAG+b'</body>'))
    verify(target)
if __name__=='__main__':update()
