"""Read the installed Steam client's Maka sprites/font; never modify game files.

Requires UnityPy. Output is for this local Steam HUD, not a redistributable skin.
The pinned bundle names and the output SHA-256 manifest identify the source build.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--bundles', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('frontend/public/maka'))
parser.add_argument('--unitypy-dir', type=Path)
args = parser.parse_args()
if args.unitypy_dir:
    sys.path.insert(0, str(args.unitypy_dir.resolve()))
import UnityPy
from PIL import Image
UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f1'

BUNDLES = {
    'common': '$0qqs86vvx5li8e9446i$i-$$-smhddflyxy11mmoe_f4a9afa3fc58fe6659d6.majset',
    'actions': '$0qqs86vvx5li8e9446i$i-$$-smhddflr3jjlb_7b2612e865f79aa59d24.majset',
    'panels': '$0qqsy$@$aazz19pm_i-88@mbmdbbdwqlhhjp21255qqsi_5139286d0d338f5828ba.majset',
    'tiles': '$0qqs86vvx-2$d224jd_88@cpopssddf9_b0b8040bed031a3206d1.majset',
    'ui': '$0qqsy$@$aazz1d6bh668nhc__agtstwwhhj-_0fbc8439ced83bb8256a.majset',
    'fonts': 'w66--ttv17fzz1s_ceb6173a5edd7ac65621.majset',
    'replay': '$0qqs86vvx5li8e9446l$gou__atnieegmzyz22nnpf_3a265865038d9f130af5.majset',
    'character': '$0qqs7$z0kyy08ol$h_779kibqvljel521ljjl4ytpprx@9@--yy0q_ea0dda70a7fd2cbb2f22.majset',
    'lobby': '$0qqs7$z0kyy0c5ag557mgb$$-fsrsvvggi__7d8565616b9062c9a745.majset',
    'lobby_chs': '$0qqs7$z0kyy0c5ag557mgb$$-flxddf9_c5568ecb17a4e01bb8b1.majset',
    'character_font': 'w66--ttv17fzz1r_b84573722da354b271ec.majset',
    'menu_font': 'w66--ttv1a-add224x_1da61973b2b3df9d8687.majset',
    'dorm': '$0qqs7$z0kyy08ol$h_779kibqvljddfysnjjlr43477ssuk_8f30f54c8ace92adff2b.majset',
    'settings': '$0qqsy$@$aazz19pm_i-88@sfvwmsmzffh0upllnt65699uuwm_870d3147b58c35a513b7.majset',
    'akagi_portrait': 'uwv8ssu060e25j9j446@h_fi__afnmomjniika_f908e664d42fea56271d.majset',
    'akagi_0_portrait': 'uwv8ssu060e25j9j446@h_fi-2aachpoqolpkkmc_f6d6cbceee3df1eb2505.majset',
    'akagi_sp_portrait': 'uwv8ssu060e25j9j446@h_fi-usbbdiqprpmqllnd_f78f3a4c8c0e7badcb0f.majset',
    'akagi_sp2_portrait': 'uwv8ssu060e25j9j446@h_fi-us6ccejrqsqnrmmoe_54917af290bc29c58e1b.majset',
}
WANTED = {
    'common': {'maka_corner_label_1', 'maka_corner_label_2', 'maka_corner_label_3', 'maka_best', 'maka_normal', 'maka_tile_bottom', 'maka_tile_bottom_blue', 'maka_text_bottom', 'text_bottom', 'dark_text_bottom', 'maka_analysis', 'maka_match_analysis_button_text_bottom_l', 'maka_match_analysis_button_open', 'maka_match_analysis_button_close', 'next_difference_bright', 'next_difference_dark'},
    'panels': {'bg_folded', 'maka_analysis_pop_up_bg'},
    'tiles': {'ob_ting_on_btn', 'ob_ting_off_btn', 'button_text_bottom_s'},
    'ui': {'pop_bound', 'Btn_common', 'Btn_gold', 'info_tabheng_dark', 'info_tab_chosen', 'blackboard',
           'light_tips_bg', 'inputbox', 'selectHuDropdownBg', 'dropdown_arrow', 'checkbox', 'check',
           'slidercomplete', 'scrollpoint', 'bf_close', 'button_gray', 'kuangbound', 'namebg', 'bg_func'},
    'replay': {'replaybox', 'expand_button', 'vline'},
    'character': {'bg_bound', 'bg_black', 'tab_bright2', 'tab_gray3', 'btn_bright', 'bf_popout',
                  'mark_selected', 'mark_unselected', 'ScrollHandlerVertical', 'scrollBgVertical', 'bound_selected', 'line', 'noinfo'},
    'lobby': {'star_slider', 'star_btn', 'btn_rand_bg', 'btn_small', 'img_return1', 'img_return1_bg'},
    'lobby_chs': {'using_1'},
    'dorm': {'btn_next', 'sushe_filte_button', 'btn_sort', 'btn_gray', 'skin_using',
             'sushe_card_normal_outline', 'sushe_click_effect', 'sushe_role_bg',
             'sushe_card_normal_star_light', 'sushe_card_normal_star_dark', 'bf_title_bg', 'dividing_line'},
    'settings': {'setting_sound_progress_base', 'setting_sound_progress_strip', 'setting_sound_progress_btn'},
    'akagi_portrait': {'bighead'},
    'akagi_0_portrait': {'bighead'},
    'akagi_sp_portrait': {'bighead'},
    'akagi_sp2_portrait': {'bighead'},
}
FONT_FILES = {
    -235241878478871845: 'HYWenHei-75W.ttf',
    -7221267878960023007: 'chs_fengyucumaokai.ttf',
    -6342260759566519630: 'SimHei.ttf',
}

# Sprite.image returns the atlas's tight rectangle. Unity's Image places that
# rectangle inside m_Rect; stretching the cropped PNG moves its corners and
# makes the selected/unselected variants disagree. Restore only these menu
# sprites, whose consumers use their original logical dimensions.
RESTORE_RECT = {'sushe_card_normal_outline', 'tab_gray3', 'using_1', 'noinfo'}

def restore_sprite_rect(sprite, cropped):
    width, height = round(sprite.m_Rect.width), round(sprite.m_Rect.height)
    offset = sprite.m_RD.textureRectOffset
    canvas = Image.new('RGBA', (width, height))
    canvas.paste(cropped, (round(offset.x), round(height - offset.y - cropped.height)))
    return canvas
manifest = {'source': 'Installed Steam Mahjong Soul (read only)', 'font_reference': {'prefab': 'myassets/ui/mj/extend/maka/prefab_output/ui_makamj.prefab', 'path_id': -235241878478871845},
            'menu_font_references': {
                'simplified_title': {'prefab': 'myassets/ui/common/extend/settings/prefab_output/ui_settings.prefab', 'path_id': -7221267878960023007, 'font_size': 42},
                'character_body': {'prefab': 'myassets/ui/lobby/extend/liaoshe/prefab_output/ui_liaoshemain.prefab', 'node': 'UI_LiaosheSelect/heads/page_deco/ContainerEffect/Viewport/Content/slot0/bg/desc', 'path_id': -6342260759566519630, 'font_size': 31},
            }, 'bundles': {}, 'files': {}}
for group, bundle in BUNDLES.items():
    path = args.bundles / bundle
    manifest['bundles'][group] = {'file': bundle, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    env = UnityPy.load(str(path))
    dest = args.output / group
    dest.mkdir(parents=True, exist_ok=True)
    for obj in env.objects:
        if obj.type.name == 'Font' and obj.path_id in FONT_FILES:
            font = obj.parse_as_object()
            output = dest / FONT_FILES[obj.path_id]
            output.write_bytes(bytes(font.m_FontData))
            info = {'original_name': font.m_Name, 'path_id': obj.path_id}
        elif obj.type.name == 'Sprite':
            sprite = obj.parse_as_object()
            name = sprite.m_Name
            wanted = name in WANTED.get(group, set()) or group == 'actions' and name.startswith(('big_', 'small_da', 'small_lizhi')) or group == 'tiles' and re.fullmatch(r'[0-9][mpsz]', name)
            if not wanted:
                continue
            im = sprite.image.convert('RGBA')
            cropped_size = list(im.size)
            if name in RESTORE_RECT:
                im = restore_sprite_rect(sprite, im)
            output = dest / (name + '.png')
            im.save(output)
            border = sprite.m_Border
            info = {'original_name': name, 'size': list(im.size), 'border_lbrt': [border.x, border.y, border.z, border.w]}
            if name in RESTORE_RECT:
                info['atlas_size'] = cropped_size
                info['logical_rect_restored'] = True
        else:
            continue
        info.update({'bundle': group, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
        manifest['files'][output.relative_to(args.output).as_posix()] = info
(args.output / 'provenance.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Extracted {len(manifest["files"])} native Maka assets to {args.output}')
