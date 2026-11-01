"""Local OnlyBomb character lab. No login, production connection or arbitrary file access."""
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, unquote
import argparse, base64, hashlib, io, json, mimetypes, struct, threading, uuid, zipfile

ROOT = Path(__file__).resolve().parent
BACKUP = ROOT.parent / '38_BACKUP_SERVIDOR_2026-10-31'
DATA = ROOT / 'web' if (ROOT / 'web/data').is_dir() else BACKUP / '01_JOGO_SITE_onlybomb.online'
NAMES = [f'{a}_{d}' for a in ('mo','st','th','pa','pu') for d in 'swne'] + ['dd','wi','wa'] + [f'{a}_{d}' for a in ('msb_ch','rui_mo','rui_st') for d in 'swne'] + ['preview','face']
EXACT = {'mo':8,'st':3,'rui_mo':8,'rui_st':3,'msb_ch':1,'preview':3,'face':1}
RANGES = {'th':(5,7),'pa':(5,8),'pu':(5,7),'dd':(7,30),'wa':(18,23)}
IMPORTS = {}; LOCK = threading.Lock()
CUSTOM = {'minato-atual':'MINATO_BOMBER','pain-atual':'PAIN_BOMBER','madara-atual':'MADARA_BOMBER','cherubimon-atual':'CHERUBIMON_VIRUS'}

def group(n):
    return n.rsplit('_',1)[0] if n[-2:] in ('_s','_w','_n','_e') else n

def inspect_gra(name, raw):
    if len(raw)<23 or raw[:4]!=b'\x00\x00\x01\x01': raise ValueError('Assinatura GRA inválida')
    n=raw[5];w,h=struct.unpack_from('<HH',raw,11);base=19+4*n
    if not n or not w or not h or max(w,h)>1024 or base>len(raw): raise ValueError('Cabeçalho inválido')
    ends=struct.unpack_from('<'+'I'*n,raw,19)
    if base+2*ends[-1]!=len(raw): raise ValueError('Tamanho divergente do cabeçalho')
    start=0;boxes=[];hashes=[];outside=[];empty=[];pixels=[];edge=[]
    for i,end in enumerate(ends):
        if end<start: raise ValueError('Offsets fora de ordem')
        p=base+2*start;stop=base+2*end;coords=[];bad=0;count=0
        while p<stop:
            if p+6>stop: raise ValueError(f'Corrida truncada no quadro {i}')
            x,y,k=struct.unpack_from('<HHH',raw,p);p+=6
            if k==0 or x+k>w or y>=h or p+2*k>stop: raise ValueError(f'Corrida fora da tela/truncada no quadro {i}')
            coords.append((x,y,x+k,y+1));count+=k
            if y<88 or y>216: bad+=k
            else: bad+=max(0,min(x+k,80)-x)+max(0,x+k-max(x,177))
            p+=2*k
        boxes.append([min(c[0] for c in coords),min(c[1] for c in coords),max(c[2] for c in coords),max(c[3] for c in coords)] if coords else None)
        hashes.append(hashlib.sha256(raw[base+2*start:stop]).hexdigest());pixels.append(count)
        if not coords: empty.append(i)
        if bad: outside.append(i)
        if boxes[-1] and (boxes[-1][0]==0 or boxes[-1][1]==0 or boxes[-1][2]==w or boxes[-1][3]==h):edge.append(i)
        start=end
    issues=[];g=group(name);size=40 if name=='face' else 256
    if (w,h)!=(size,size):issues.append({'level':'error','text':f'Tela {w}×{h}; esperado {size}×{size}'})
    if g in EXACT and n!=EXACT[g]:issues.append({'level':'error','text':f'{n} quadros; esperado {EXACT[g]} (sincronia/quadro usado pelo cliente)'})
    if g in RANGES and not RANGES[g][0]<=n<=RANGES[g][1]:issues.append({'level':'error','text':f'{n} quadros; faixa conhecida do importador {RANGES[g][0]}–{RANGES[g][1]}'})
    if g=='wi' and n not in (9,11,22):issues.append({'level':'warning','text':'Contagem de vitória não comprovada no importador. O motor lê a contagem do arquivo.'})
    if empty:issues.append({'level':'warning','text':f'Quadros vazios: {empty}'})
    if edge and name!='face':issues.append({'level':'warning','text':f'Pixels na borda da tela: {edge}'})
    if outside and g in ('mo','st','th','pa','pu'):issues.append({'level':'warning','text':f'Fora da área segura recomendada: {outside}'})
    if g in ('mo','pa','st','rui_mo','rui_st') and len(set(hashes))<n:issues.append({'level':'warning','text':'Há quadros binariamente repetidos; conferir movimento visualmente.'})
    return dict(file=name+'.gra',frames=n,w=w,h=h,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),boxes=boxes,hashes=hashes,pixels=pixels,issues=issues)

def analyze(files):
    sheets={};issues=[]
    for n in NAMES:
        raw=files.get(n+'.gra')
        if raw is None:issues.append({'level':'error','file':n+'.gra','text':'Folha ausente'});continue
        try:
            s=inspect_gra(n,raw);sheets[n]=s
            issues.extend(dict(file=n+'.gra',**x) for x in s['issues'])
        except (ValueError,struct.error) as e:issues.append({'level':'error','file':n+'.gra','text':str(e)})
    meta=None
    if 'character.json' in files:
        try:
            meta=json.loads(files['character.json'].decode('utf-8-sig'))
            if not isinstance(meta,dict) or meta.get('format')!='spr-viewer character 1':raise ValueError('Formato esperado: spr-viewer character 1')
            rows=meta.get('sheets',[])
            if not isinstance(rows,list) or len(rows)!=37:raise ValueError('character.json precisa listar 37 folhas')
            expected=[n+'.gra' for n in NAMES]
            if [s.get('file') for s in rows]!=expected:issues.append({'level':'error','file':'character.json','text':'Ordem/nomes das37 folhas divergentes do cliente'})
            for s in rows:
                if not isinstance(s,dict):raise ValueError('Entrada de folha inválida')
                n=s.get('file','').removesuffix('.gra');g=sheets.get(n)
                if g and any(s.get(k)!=g[k] for k in ('frames','w','h')):issues.append({'level':'error','file':s.get('file'),'text':'Contagem/dimensões no JSON divergem do GRA'})
        except (ValueError,TypeError,AttributeError) as e:issues.append({'level':'error','file':'character.json','text':str(e)});meta=None
    else:issues.append({'level':'warning','file':'character.json','text':'Ausente: é necessário para o pacote de importação definitivo'})
    seams=[]
    def seam(a,ia,b,ib):
        if a in sheets and b in sheets and -sheets[a]['frames']<=ia<sheets[a]['frames'] and -sheets[b]['frames']<=ib<sheets[b]['frames']:
            same=sheets[a]['hashes'][ia]==sheets[b]['hashes'][ib]
            seams.append(dict(a=a,ia=ia,b=b,ib=ib,equal=same))
    for d in 'swne':
        for a in ('th','pu'):seam(a+'_'+d,-1,'st_'+d,0)
        seam('mo_'+d,-1,'mo_'+d,0)
    seam('wa',0,'st_s',0);seam('wi',-1,'wi',0);seam('dd',-1,'dd',-2)
    if 'preview.gra' in files and 'st_s.gra' in files and files['preview.gra']!=files['st_s.gra']:issues.append({'level':'warning','file':'preview.gra','text':'Não é cópia binária do st_s.gra'})
    return dict(sheets=sheets,issues=issues,seams=seams,metadata=meta,files=len(sheets),frames=sum(s['frames'] for s in sheets.values()),valid=not any(x['level']=='error' for x in issues),note='Validação local não substitui aprovação artística nem o importador do servidor. Emendas diferentes podem ser intencionais.')

def collect(entries):
    files={}
    for name,raw in entries:
        leaf=name.replace('\\','/').rsplit('/',1)[-1].lower()
        if leaf not in {n+'.gra' for n in NAMES}|{'character.json'}:continue
        if leaf in files:raise ValueError('Nome duplicado: '+leaf+'. Importe um personagem por vez.')
        if len(raw)>8_000_000:raise ValueError('Arquivo excede8MB')
        files[leaf]=raw
    if not files:raise ValueError('Nenhum GRA/character.json reconhecido')
    return files

def unzip(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries=z.infolist()
        if len(entries)>1000 or sum(i.file_size for i in entries)>80_000_000:raise ValueError('ZIP excede o limite de80MB/1000entradas')
        return collect((i.filename,z.read(i)) for i in entries if not i.is_dir() and i.filename.lower().endswith(('.gra','character.json')))

def project_files(slug):
    folder=ROOT.parent/'Personagens Customizados'/CUSTOM[slug]/'entrega'
    packs=[p for p in folder.iterdir() if p.is_dir() and (p/'st_s.gra').is_file()] if folder.exists() else []
    if not packs:return None
    return collect((p.name,p.read_bytes()) for p in packs[0].iterdir() if p.is_file() and p.suffix.lower() in ('.gra','.json'))

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,data,kind='application/json; charset=utf-8',guide=False):
        if isinstance(data,(dict,list)):data=json.dumps(data,ensure_ascii=False).encode('utf8')
        if isinstance(data,str):data=data.encode('utf8')
        policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; media-src 'self' blob:"
        if guide:policy="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'"
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',policy);self.end_headers();self.wfile.write(data)
    def do_GET(self):
        url=unquote(urlsplit(self.path).path)
        if url=='/api/health':return self.reply(200,dict(ok=True,tool='OnlyBomb Character Lab',version=1,backup=BACKUP.is_dir()))
        if url=='/api/catalog':
            projects=[dict(id=s,name=folder.replace('_',' ').title(),folder=s) for s,folder in CUSTOM.items() if project_files(s)]
            with LOCK:imported=[dict(id=s,name=d['name'],folder=s) for s,d in IMPORTS.items()]
            return self.reply(200,projects+imported)
        if url.startswith('/api/report/'):
            slug=url.rsplit('/',1)[-1];files=project_files(slug) if slug in CUSTOM else IMPORTS.get(slug,{}).get('files')
            return self.reply(200,analyze(files)) if files else self.reply(404,dict(error='Personagem não encontrado'))
        if url.startswith('/skins/characters/'):
            parts=url.strip('/').split('/')
            if len(parts)!=4:return self.reply(404,dict(error='Rota inválida'))
            slug,leaf=parts[2:];files=project_files(slug) if slug in CUSTOM else IMPORTS.get(slug,{}).get('files')
            return self.reply(200,files[leaf],'application/octet-stream') if files and leaf in files else self.reply(404,dict(error='Arquivo ausente'))
        if url=='/sideart.json' and (DATA/'sideart.json').is_file():return self.reply(200,(DATA/'sideart.json').read_bytes())
        if url=='/favicon.ico':return self.reply(204,b'','image/x-icon')
        roots=[('/data/',DATA/'data'),('/img/',DATA/'img'),('/i18n/',DATA/'i18n'),('/sideart/',DATA/'sideart')]
        base=ROOT/'web';rel='index.html' if url=='/' else url.lstrip('/')
        for prefix,folder in roots:
            if url.startswith(prefix):base=folder;rel=url[len(prefix):];break
        target=(base/rel).resolve()
        if target.is_dir():target=(target/'index.html').resolve()
        if not target.is_relative_to(base.resolve()) or not target.is_file():return self.reply(404,dict(error='Arquivo não encontrado',path=url))
        kind='text/javascript; charset=utf-8' if target.suffix in ('.js','.mjs') else mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        self.reply(200,target.read_bytes(),kind,guide=target==(ROOT/'web/guia/index.html').resolve())
    def do_POST(self):
        origin=self.headers.get('Origin')
        if origin and origin not in (f'http://localhost:{self.server.server_port}',f'http://127.0.0.1:{self.server.server_port}'):return self.reply(403,dict(error='Origem não permitida'))
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=45_000_000:raise ValueError('Limite45MB por envio')
            raw=self.rfile.read(size)
            if self.path=='/api/import-zip':files=unzip(raw)
            elif self.path=='/api/import':
                data=json.loads(raw);files=collect((f['name'],base64.b64decode(f['data'],validate=True)) for f in data['files'])
            elif self.path=='/api/browser-test':
                data=json.loads(raw);(ROOT/'resultado_browser.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8');return self.reply(200,dict(ok=True))
            else:return self.reply(404,dict(error='Rota inválida'))
            report=analyze(files);slug='import-'+uuid.uuid4().hex[:12];meta=report.get('metadata') or {};name=str(meta.get('name') or self.headers.get('X-Character-Name') or 'Personagem importado')[:80]
            with LOCK:IMPORTS[slug]=dict(files=files,name=name)
            return self.reply(200,dict(id=slug,folder=slug,name=name,report=report))
        except (ValueError,KeyError,TypeError,zipfile.BadZipFile,RuntimeError,EOFError) as e:self.reply(400,dict(error=str(e)))
    def log_message(self,fmt,*args):
        if len(args)>1 and str(args[1]) not in ('200','304'):print(fmt%args,flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8768);args=parser.parse_args()
    print(f'Simulador local: http://localhost:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
