// Every sprite, effect and string the match screen uses, loaded once (FUN_004150f0 & co.).

import { loadSprite, loadBinary } from "../assets/spr.js";
import { Runs, Eft, setFont } from "./fb565.js";

const SPRITES = {
  // map (Battle)
  bg0: "map/MAP_09.spr", bg1: "map/map_00.spr", bg2: "map/MAP_01.spr", bg3: "map/MAP_06.spr", bg4: "map/MAP_03.spr",
  bg5: "map/MAP_04.spr", bg6: "map/MAP_05.spr", bg7: "map/MAP_08.spr", bg8: "map/MAP_10.spr",
  non: "map/non.spr", pp: "map/pp.spr", non_sh: "map/non_sh.spr", pp_sh: "map/pp_sh.spr", tile: "map/tile.spr",
  // bombs
  bomb_s: "bomb/bomb_s.spr", bomb: "bomb/bomb.spr", bomb_d: "bomb/bomb_d.spr", pbomb: "bomb/PBOMB.SPR",
  pbomb_d: "bomb/PBOMB_D.SPR", bbomb: "bomb/BBOMB.SPR", bbomb_d: "bomb/BBOMB_D.SPR", dbomb: "bomb/DBOMB.SPR",
  dbomb_d: "bomb/DBOMB_D.SPR",
  // items (type order) + shadow
  it0: "item/item_fireup.spr", it1: "item/item_speedup.spr", it2: "item/item_bombup.spr", it3: "item/item_bombkick.spr",
  it4: "item/item_bombthrow.spr", it5: "item/item_skull.spr", it6: "item/item_powersuits.spr",
  it7: "item/item_fullfire.spr", it8: "item/item_egg.spr", it9: "item/item_punch.spr", it10: "item/item_linebomb.spr",
  it11: "item/item_passbomb.spr", it12: "item/item_waterbomb.spr", it13: "item/item_hyperbomb.spr",
  item_gray: "item/item_gray.spr", item_sh: "item/item_sh.spr", hyperball: "item/item_hyperball.spr",
  // HUD
  ui_trophy: "UI/UI_trophy.spr", num_s: "UI/UI_number_small.spr", colon: "UI/UI_colon.spr", ui_class: "UI/UI_class.spr",
  ui_ok: "UI/UI_OK.SPR", ui_back: "UI/UI_back.spr",
  p_panel: "UI/UI_123p_panel.spr", p_arrow: "UI/UI_123P_arrow.spr", p_revive: "UI/UI_123P_revive.spr",
  ready: "font/ready.spr", go: "font/go.spr", hurry: "font/hurry.spr", caret: "lobby/login/caret.spr",
  // results
  res_win: "result/round_cup.spr", txt_win: "result/result_text_win.spr", txt_lose: "result/result_text_lose.spr",
  txt_draw: "result/result_text_draw.spr", round_cup: "result/round_cup.spr",
  // players
  ringr: "effect/ringr.gra", ringb: "effect/ringb.gra", ringg: "effect/ringg.gra", msb: "player/msb.spr",
  // map gimmicks (J_gimmicks.md)
  cb_w: "UI/UI_CBelt_W.spr", cb_n: "UI/UI_CBelt_N.spr", cb_se: "UI/UI_CBelt_SE.spr", cb_ne: "UI/UI_CBelt_NE.spr",
  cb_en: "UI/UI_CBelt_EN.spr", cb_es: "UI/UI_CBelt_ES.spr", cb_ss: "UI/UI_CBelt__S_S.spr", cb_we: "UI/UI_CBelt__W_E.spr",
  cb_ns: "UI/UI_CBelt__N_S.spr", cb_ee: "UI/UI_CBelt__E_E.spr", dirswitch: "UI/UI_CBELT_DIRSWITCH.SPR",
  speedswitch: "UI/UI_SPEEDSWITCH.SPR", crackice: "UI/UI_CRACKICE.SPR", warp: "UI/UI_warp.spr", arrow: "UI/UI_arrow.spr",
  arrow_change: "UI/UI_arrow_change.spr", tunnel: "UI/UI_tunnel.spr",
  ds_r: "UI/UI_DRIFTSAND_R.SPR", ds_l: "UI/UI_DRIFTSAND_L.SPR", ds_tr1: "UI/UI_DRIFTSAND_TR1.SPR",
  ds_tr2: "UI/UI_DRIFTSAND_TR2.SPR", ds_tl1: "UI/UI_DRIFTSAND_TL1.SPR", ds_tl2: "UI/UI_DRIFTSAND_TL2.SPR",
};
export const ITEM_SPRITES = Array.from({ length: 13 }, (_, t) => SPRITES["it" + t]);   // the room's item icons

const EFFECTS = {
  my: "my.eft", my_in: "my-in.eft", super: "super.eft", cures: "cures.eft", get_item: "get-item.eft", star: "star.eft",
  bomb_f: "bomb_f.eft", boom: "boom.eft", boom_block: "boom_block.eft", createitem: "createitem.eft",
  f0: "FLAME_CENTER.EFT", f1: "FLAME_HOR.EFT", f2: "FLAME_VER.EFT", f3: "FLAME_RIGHT.EFT", f4: "FLAME_LEFT.EFT",
  f5: "FLAME_UP.EFT", f6: "FLAME_DOWN.EFT",
};

export const A = {};      // name -> Runs / Eft
export const MSG = {};    // msgtable.str id -> text
let loading = null;

export function loadAssets() {
  if (!loading) {
    loading = (async () => {
      const jobs = [];
      for (const [k, path] of Object.entries(SPRITES)) {
        jobs.push(loadSprite(path).then((s) => { A[k] = Runs.fromSprite(s); }).catch((e) => console.warn(e.message)));
      }
      for (const [k, file] of Object.entries(EFFECTS)) {
        jobs.push(loadBinary("effect/" + file).then((b) => { A[k] = new Eft(b); }).catch((e) => console.warn(e.message)));
      }
      jobs.push(loadBinary("font/Font_Eng_6.fnt").then(setFont).catch(() => {}));
      jobs.push(loadBinary("lobby/msgtable.str").then(parseMsgTable).catch(() => {}));
      await Promise.all(jobs);
      A.items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => A["it" + i]);
      A.flames = [0, 1, 2, 3, 4, 5, 6].map((i) => A["f" + i]);
      A.bgs = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => A["bg" + i]);
    })();
  }
  return loading;
}

// msgtable.str: repeated { u32 id, u32 len, bytes[len] } (Shift-JIS)
function parseMsgTable(buf) {
  const v = new DataView(buf), dec = new TextDecoder("shift_jis");
  let p = 0;
  while (p + 8 <= buf.byteLength) {
    const id = v.getUint32(p, true), len = v.getUint32(p + 4, true);
    p += 8;
    if (len > 4096 || p + len > buf.byteLength) break;
    const bytes = new Uint8Array(buf, p, len);
    let n = bytes.indexOf(0);
    if (n < 0) n = len;
    MSG[id] = dec.decode(bytes.subarray(0, n));
    p += len;
  }
}

export function msg(id, fallback = "") { return MSG[id] !== undefined ? MSG[id] : fallback; }
