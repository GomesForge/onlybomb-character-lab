"""Technical HD regression fixtures from official White; not character artwork deliverables."""
from pathlib import Path
import sys,json,zipfile,io,shutil,hashlib
from PIL import Image,ImageDraw
P=Path(__file__).resolve().parent;G=P.parent/'39_GUIA_CRIACAO_PERSONAGENS/anexos'
sys.path.insert(0,str(G));import gra_ferramenta as gf
OUT=P/'.test-data';OUT.mkdir(exist_ok=True)
for fmt in ('png','webp'):
    folder=OUT/('hd-'+fmt);folder.mkdir(exist_ok=True)
    for n in gf.NOMES:shutil.copyfile(G/('White_'+n+'.gra'),folder/(n+'.gra'))
    gf.cmd_json(str(folder),'Fixture HD oficial · '+fmt,'fixture-hd-'+fmt)
    gra=gf.Gra.abrir(folder/'mo_s.gra');frames=[Image.frombytes('RGBA',(256,256),bytes(gf.quadro_rgba(gra,i))) for i in range(8)]
    bb=[im.getbbox() for im in frames];x=min(b[0] for b in bb);y=min(b[1] for b in bb);bw=max(b[2] for b in bb)-x;bh=max(b[3] for b in bb)-y
    k=2;atlas=Image.new('RGBA',(bw*k*4,bh*k*2));rects=[]
    for i,im in enumerate(frames):
        cell=im.crop((x,y,x+bw,y+bh)).resize((bw*k,bh*k),Image.Resampling.NEAREST)
        # Small subpixel checker inside an already opaque helmet pixel: lets browser QA distinguish HD from GRA.
        px=cell.load();marked=False
        for cy in range(8,cell.height//2):
            for cx in range(cell.width//3,cell.width*2//3):
                if all(px[cx+dx,cy+dy][3]==255 for dx in range(2) for dy in range(2)):
                    for dx in range(2):
                        for dy in range(2):px[cx+dx,cy+dy]=(40,170,240,255) if dx==dy else (240,250,255,255)
                    marked=True;break
            if marked:break
        ax=i%4*bw*k;ay=i//4*bh*k;atlas.alpha_composite(cell,(ax,ay));rects.append([ax,ay,0,0,bw*k,bh*k])
    hd=folder/'hd';hd.mkdir(exist_ok=True);atlas.save(hd/('mo_s.'+fmt),**({'lossless':True} if fmt=='webp' else {}))
    m=dict(frames=8,box=[x,y,bw,bh],size=list(atlas.size))
    if fmt=='png':m['cols']=4 # Legacy grid path.
    else:m['rects']=rects # Current WebP/rects path.
    (hd/'hd.json').write_text(json.dumps(dict(format=fmt,scale=k,grey_bit=False,sheets=dict(mo_s=m))),encoding='utf8')
    with zipfile.ZipFile(OUT/('oficial-hd-'+fmt+'.zip'),'w',zipfile.ZIP_DEFLATED) as z:
        for p in folder.rglob('*'):
            if p.is_file():z.write(p,'fixture-hd-'+fmt+'/'+p.relative_to(folder).as_posix())
    print(fmt,atlas.size,'fixture ZIP ready')
