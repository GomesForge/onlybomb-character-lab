"""Build a static site for GitHub Pages, including exact-case asset URLs on Linux.
No dependencies; imported custom characters are deliberately absent from the build.
"""
from pathlib import Path
import hashlib, json, re, shutil
from guia_apresentacao import verify as verify_guide
ROOT=Path(__file__).resolve().parent
DIST=ROOT/'dist'

def build():
    DIST.mkdir(exist_ok=True)
    shutil.copytree(ROOT/'web',DIST,dirs_exist_ok=True)
    guide=json.loads((ROOT/'ORIGEM_GUIA.json').read_text(encoding='utf8'))
    verify_guide(DIST/guide['file'])
    data=ROOT/'web/data'
    paths={p.relative_to(data).as_posix().lower():p for p in data.rglob('*') if p.is_file()}
    wanted=set()
    # Literal files used by original modules; dynamic White/Louie and sound tables below.
    for p in (ROOT/'web/js').rglob('*.js'):
        source=p.read_text(encoding='utf8')
        for name in re.findall(r'["\']([^"\'\n`]+\.(?:spr|gra|eft|fnt|str|wav))["\']',source,re.I):
            if '${' in name:continue
            if name.lower() in paths:wanted.add(name)
            elif ('effect/'+name).lower() in paths:wanted.add('effect/'+name)
    wanted.update('player/Lui/'+a+'_'+d+'.gra' for a in ('MO','ST') for d in 'SWNE')
    names=[f'{a}_{d}' for a in ('mo','st','th','pa','pu') for d in 'swne']+['dd','wi','wa']+[f'{a}_{d}' for a in ('msb_ch','rui_mo','rui_st') for d in 'swne']+['face']
    wanted.update('player/White/'+n+'.gra' for n in names)
    sounds=re.search(r'export const SOUNDS = \[(.*?)\];',(ROOT/'web/js/game/sound.js').read_text(encoding='utf8'),re.S)[1]
    wanted.update('sound/'+n+'.wav' for n in re.findall(r'"([^"]+)"',sounds))
    # No source mutations: duplicate URL spellings only when the host is case-sensitive.
    for name in sorted(wanted):
        original=paths.get(name.lower())
        if original is None:raise ValueError('Missing game asset: '+name)
        target=DIST/'data'/name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.is_file() or target.read_bytes()!=original.read_bytes():shutil.copyfile(original,target)
    (DIST/'.nojekyll').write_text('')
    (DIST/'favicon.ico').write_bytes(b'')
    original=json.loads((ROOT/'ORIGEM_MODULOS.json').read_text(encoding='utf-8-sig'))
    for item in original['files']:
        assert hashlib.sha256((DIST/'js'/item['file']).read_bytes()).hexdigest()==item['sha256'],item['file']
    print(json.dumps({'build':'dist','unchanged_original_modules':len(original['files']),'asset_urls_checked':len(wanted),'character_packages_included':0}))

if __name__=='__main__':build()
