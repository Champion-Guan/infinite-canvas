import type { Position } from "@/types/canvas";
export type RoutingBox = { left: number; right: number; top: number; bottom: number };
export function segmentBlocked(a: Position, b: Position, boxes: readonly RoutingBox[]) {
    return boxes.some(r => a.y === b.y
        ? a.y > r.top && a.y < r.bottom && Math.max(a.x, b.x) > r.left && Math.min(a.x, b.x) < r.right
        : a.x > r.left && a.x < r.right && Math.max(a.y, b.y) > r.top && Math.min(a.y, b.y) < r.bottom);
}
// 稀疏坐标网格 A*：仅在端口和障碍边界转向，方向状态用于惩罚多余折返。
export function avoidCards(start: Position, end: Position, boxes: readonly RoutingBox[], preferredX: number): Position[] | null {
    const xs = [...new Set([start.x, end.x, preferredX, ...boxes.flatMap(r => [r.left, r.right])])].sort((a,b)=>a-b);
    const ys = [...new Set([start.y, end.y, ...boxes.flatMap(r => [r.top,r.bottom])])].sort((a,b)=>a-b);
    const width=xs.length, point=(i:number)=>({x:xs[i%width],y:ys[Math.floor(i/width)]});
    const source=ys.indexOf(start.y)*width+xs.indexOf(start.x), target=ys.indexOf(end.y)*width+xs.indexOf(end.x);
    const distance=new Map<number,number>(), parent=new Map<number,number>();
    type Entry={key:number; cost:number; score:number}; const heap:Entry[]=[];
    const push=(e:Entry)=>{heap.push(e);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].score<=e.score)break;heap[i]=heap[p];i=p;}heap[i]=e;};
    const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
    const initial=source*2; distance.set(initial,0);push({key:initial,cost:0,score:0});
    const blocked=new Map<string,boolean>();
    while(heap.length){const entry=pop();if(distance.get(entry.key)!==entry.cost)continue;
        const cell=Math.floor(entry.key/2),dir=entry.key%2,a=point(cell);
        if(cell===target){const path:Position[]=[];let k:number|undefined=entry.key;while(k!==undefined){path.push(point(Math.floor(k/2)));k=parent.get(k);}return path.reverse();}
        const x=cell%width,y=Math.floor(cell/width);
        for(const [nx,ny,nd] of [[x-1,y,0],[x+1,y,0],[x,y-1,1],[x,y+1,1]]){
            if(nx<0||nx>=width||ny<0||ny>=ys.length)continue;
            const next=ny*width+nx,b=point(next),edge=cell<next?`${cell}:${next}`:`${next}:${cell}`;
            // 与外部水平端口短接保持同向，不能离开端口后立刻沿原线折回。
            if (nd === 0 && ((cell === source && b.x < start.x) || (next === target && a.x > end.x))) continue;
            let hit=blocked.get(edge);if(hit===undefined){hit=segmentBlocked(a,b,boxes);blocked.set(edge,hit);}if(hit)continue;
            const cost=entry.cost+Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+(dir!==nd?36:0)+(nd===1&&a.x!==preferredX?0.02:0);
            const key=next*2+nd;if(cost>=(distance.get(key)??Infinity))continue;
            distance.set(key,cost);parent.set(key,entry.key);push({key,cost,score:cost+Math.abs(b.x-end.x)+Math.abs(b.y-end.y)});
        }
    }
    return null;
}
