"""Derive HUD geometry from original Steam sprites, without copying game textures.

Developer-only: Python, UnityPy 1.25.3, numpy, scipy. Pass one or more
--atlas chs=PATH / --atlas chs_t=PATH bundle arguments. Does not modify the game.
The generated pack contains source hashes, outer alpha paths and sparse opaque
interior samples. Unity/Python are not required by the running HUD.
"""
import argparse
import hashlib
import json
import warnings
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, uniform_filter, gaussian_filter
import UnityPy

OPS = {
    "op_hu": ["ron"], "op_zimo": ["tsumo"], "op_peng": ["pon"],
    "op_chi": ["chi"], "op_gang": ["ankan", "kakan", "daiminkan"],
    "op_lizhi": ["reach"], "op_x": ["pass"], "op_babei": ["kita"],
    "op_liuju": ["ryukyoku"],
}


def outer_paths(alpha):
    """March the 50% alpha boundary; shadows and inner flower/letter holes drop out."""
    # Reconstruct the continuous alpha boundary before tracing. A small filter
    # removes one-source-pixel stair steps; real corners and ribbon trim remain.
    alpha = gaussian_filter(np.pad(alpha.astype(float), 3), .65, mode='constant')
    edges = {}
    for y in range(alpha.shape[0] - 1):
        for x in range(alpha.shape[1] - 1):
            p = [(x,y), (x+1,y), (x+1,y+1), (x,y+1)]
            v = [alpha[py,px] for px,py in p]
            crossings = []
            for i in range(4):
                j = (i+1) % 4
                if (v[i] >= 128) != (v[j] >= 128):
                    t = (128-v[i])/(v[j]-v[i])
                    a,b = p[i],p[j]
                    crossings.append((round(a[0]+t*(b[0]-a[0])-3,5), round(a[1]+t*(b[1]-a[1])-3,5)))
            for a,b in zip(crossings[::2],crossings[1::2]):
                edges.setdefault(a,[]).append(b)
                edges.setdefault(b,[]).append(a)
    loops=[]
    while edges:
        start=next(iter(edges)); at=start; path=[]
        while at in edges:
            path.append(at)
            nxt=edges[at].pop()
            if not edges[at]:del edges[at]
            edges[nxt].remove(at)
            if not edges[nxt]:del edges[nxt]
            at=nxt
            if at==start:break
        if len(path)>3:loops.append(path)
    def area(p):
        return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(p,p[1:]+p[:1])))
    # Subpixel RDP, in original sprite coordinates. The result is stable vector
    # geometry; a screenshot's color, labels and outline can never alter it.
    def rdp(p):
        a=np.array(p[0]);b=np.array(p[-1]);q=np.array(p)
        d=b-a; length=np.linalg.norm(d)
        distances=np.linalg.norm(q-a,axis=1) if length==0 else abs(d[1]*q[:,0]-d[0]*q[:,1]+b[0]*a[1]-b[1]*a[0])/length
        i=int(distances.argmax())
        if distances[i] <= .24:return [p[0],p[-1]]
        return rdp(p[:i+1])[:-1]+rdp(p[i:])
    def inside(p, polygon):
        result=False
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            if (a[1]>p[1]) != (b[1]>p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:result=not result
        return result
    outer=[]
    for path in sorted(loops,key=area,reverse=True):
        if area(path)<20 or any(inside(path[0],parent) for parent in outer):continue
        outer.append(path)
    return [[[round(x,4),round(y,4)] for x,y in rdp(path+[path[0]])[:-1]] for path in outer]


def generate(atlases):
    UnityPy.config.FALLBACK_UNITY_VERSION='2022.3.62f1'
    pack={'schema':3,'generator':'UnityPy 1.25.3; alpha sigma 0.65 at 128/255; RGB and 3x3 filtered interior samples','sources':[],'templates':[]}
    for language,bundle in atlases:
        pack['sources'].append({'language':language,'bundle':bundle.name,'sha256':hashlib.sha256(bundle.read_bytes()).hexdigest()})
        env=UnityPy.load(str(bundle))
        for obj in env.objects:
            if obj.type.name!='Sprite':continue
            sprite=obj.parse_as_object()
            if sprite.m_Name not in OPS:continue
            pixels=np.asarray(sprite.image.convert('RGBA'))
            alpha=pixels[:,:,3]
            ys,xs=np.where((alpha>=250)&(distance_transform_edt(alpha>=250)>3.5))
            indexes=np.linspace(0,len(xs)-1,min(256,len(xs))).astype(int)
            filtered=uniform_filter(pixels[:,:,:3].astype(float),size=(3,3,1),mode='nearest')
            samples=[[int(xs[i]),int(ys[i]),*[int(c) for c in pixels[ys[i],xs[i],:3]],*[round(float(c),3) for c in filtered[ys[i],xs[i]]]] for i in indexes]
            paths=outer_paths(alpha)
            xy=np.concatenate([np.array(path) for path in paths]);low=xy.min(axis=0);high=xy.max(axis=0)
            pack['templates'].append({'language':language,'sprite':sprite.m_Name,'actions':OPS[sprite.m_Name],
                'width':pixels.shape[1],'height':pixels.shape[0],
                'bounds':[round(float(v),4) for v in [*low,*(high-low)]],
                'paths':paths,'samples':samples})
    pack['templates'].sort(key=lambda t:(t['sprite'],t['language']))
    return pack


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas',action='append',required=True,help='LANGUAGE=BUNDLE')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        pack=generate([(s.split('=',1)[0],Path(s.split('=',1)[1])) for s in args.atlas])
    args.output.write_text(json.dumps(pack,separators=(',',':'))+'\n',encoding='utf-8')
    print(f"Generated {len(pack['templates'])} original control templates: {args.output}")
