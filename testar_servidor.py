from pathlib import Path
import importlib.util, io, json, struct, unittest, zipfile
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('lab_server',P/'servidor.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
def gra(n=3,w=256):
    frame=struct.pack('<HHHH',120,195,1,0xffff)
    return b'\0\0\1\1'+bytes([3,n,100])+bytes(4)+struct.pack('<HHI',w,w,0)+struct.pack('<'+'I'*n,*[(i+1)*4 for i in range(n)])+frame*n
class ValidationTests(unittest.TestCase):
    def test_official_prop_outside_recommended_area_is_valid(self):
        raw=(P.parent/'31_KIT_PERSONAGEM/TODOS_OS_PERSONAGENS/Special_26/ARQUIVOS_DO_JOGO/mo_w.gra').read_bytes()
        sheet=server.inspect_gra('mo_w',raw)
        self.assertEqual(sheet['boxes'][2],[74,122,148,190])
        self.assertFalse(any(i['level']=='error' for i in sheet['issues']))
        self.assertTrue(any('recomendada' in i['text'] for i in sheet['issues']))
    def test_integral_guide_hash_and_fullscreen_controls(self):
        import hashlib
        origin=json.loads((P/'ORIGEM_GUIA.json').read_text(encoding='utf8'))
        from guia_apresentacao import verify
        self.assertEqual(hashlib.sha256(verify(P/'web'/origin['file'])).hexdigest(),origin['sha256'])
        page=(P/'web/index.html').read_text(encoding='utf8')
        surface=page.split('<section id="play-surface">')[1].split('</section>')[0]
        self.assertLess(surface.index('test-actions'),surface.index('id="arena"'))
        self.assertLess(surface.index('training-current-file'),surface.index('id="arena"'))
        self.assertNotIn('expand-arena',page)
        self.assertIn('lab-previous-file',page)
        self.assertIn('href="./guia/"',page)
    def test_gra_and_corruption(self):
        self.assertEqual(server.inspect_gra('st_s',gra())['frames'],3)
        for raw in (b'',gra()[:-1],gra()+b'x',b'xxxx'+gra()[4:]):
            with self.assertRaises(ValueError):server.inspect_gra('st_s',raw)
    def test_count_sync(self):
        for name,n in [('mo_s',16),('st_s',4),('rui_mo_w',6),('th_e',14),('wa',36)]:
            s=server.inspect_gra(name,gra(n));self.assertTrue(any(i['level']=='error' for i in s['issues']))
    def test_duplicate_import(self):
        with self.assertRaises(ValueError):server.collect([('one/st_s.gra',gra()),('two/st_s.gra',gra())])
    def test_zip_no_extraction(self):
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:z.writestr('character/st_s.gra',gra());z.writestr('../../unrelated.txt','ignored')
        self.assertEqual(list(server.unzip(buf.getvalue())),['st_s.gra'])
    def test_missing_invalid_json(self):
        self.assertFalse(server.analyze({'st_s.gra':gra(),'character.json':b'[]'})['valid'])
    def test_current_projects(self):
        for slug in server.CUSTOM:
            f=server.project_files(slug);self.assertIsNotNone(f,slug);r=server.analyze(f)
            self.assertEqual(r['files'],37,slug);self.assertTrue(r['valid'],(slug,r['issues']))
    def test_face_can_fill_40px_canvas(self):
        raw=server.project_files('madara-atual')['face.gra']
        self.assertFalse(any('borda' in i['text'] for i in server.inspect_gra('face',raw)['issues']))
    def test_relative_modules_available_and_original(self):
        import re,hashlib
        originals=server.BACKUP/'02_JOGO_CODIGO_FONTE/js'
        for p in (P/'web/js').rglob('*.js'):
            self.assertEqual(p.read_bytes(),(originals/p.relative_to(P/'web/js')).read_bytes(),str(p))
            for relative in re.findall(r'(?:from\s*|import\s*)[\'"](\.[^\'"]+)[\'"]',p.read_text(encoding='utf8')):
                self.assertTrue((p.parent/relative).resolve().is_file(),(p,relative))
if __name__=='__main__':unittest.main(verbosity=2)
