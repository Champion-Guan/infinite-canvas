import { mergeSharedConnectionSegments, type ConnectionGeometry } from './圆角连线路由';

type Point = { x: number; y: number };
const key = (p: Point) => `${Math.round(p.x*1000)}:${Math.round(p.y*1000)}`;
function progress(p: Point, route: readonly Point[]) {
    let distance=0, best=Infinity, result=0;
    for(let i=1;i<route.length;i++){
        const a=route[i-1],b=route[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
        const t=length ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(length*length))) : 0;
        const error=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
        if(error<best){best=error;result=distance+t*length;}distance+=length;
    }
    return result;
}

// 唯一线段组成有向网络。汇合取最长到达时间；短分支延后发车，所有分支保持相同速度。
export function sharedNetworkFlow(geometry: readonly ConnectionGeometry[], topology: readonly ConnectionGeometry[] = geometry) {
    const byId=new Map(geometry.map(item=>[item.connection.id,item]));
    const edges=mergeSharedConnectionSegments(geometry, topology).map(segment=>{
        const values=segment.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number)??[];
        let a={x:values[0],y:values[1]},b={x:values.at(-2)!,y:values.at(-1)!};
        const control=values.length===6?{x:values[2],y:values[3]}:null;
        const route=byId.get(segment.connectionIds[0])!.route.points;
        if(progress(a,route)>progress(b,route))[a,b]=[b,a];
        let length=0,previous=a;
        for(let i=1;i<=16;i++){
            const t=i/16,u=1-t;
            const p=control?{x:u*u*a.x+2*u*t*control.x+t*t*b.x,y:u*u*a.y+2*u*t*control.y+t*t*b.y}:{x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)};
            length+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;
        }
        return {virtual:false,id:segment.key,from:key(a),to:key(b),length,d:control?`M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`:`M ${a.x} ${a.y} L ${b.x} ${b.y}`};
    });
    const inputs=new Map<string,Point>(),outputs=new Map<string,Point>();
    for(const item of geometry){inputs.set(item.to.id,item.route.points.at(-1)!);outputs.set(item.from.id,item.route.points[0]);}
    for(const [id,a] of inputs){const b=outputs.get(id);if(b&&key(a)!==key(b))edges.push({virtual:true,id:`card:${id}`,from:key(a),to:key(b),length:Math.hypot(b.x-a.x,b.y-a.y),d:''});}
    // 压缩普通折点和卡片穿行，等待只发生在完整分支出发前，不能挤在短尾段。
    const outgoing=new Map<string,typeof edges>(),indegree=new Map<string,number>();
    for(const edge of edges){indegree.set(edge.from,indegree.get(edge.from)??0);indegree.set(edge.to,(indegree.get(edge.to)??0)+1);const list=outgoing.get(edge.from)??[];list.push(edge);outgoing.set(edge.from,list);}
    const boundary=(id:string)=>indegree.get(id)!==1||(outgoing.get(id)?.length??0)!==1;
    type Branch={from:string;to:string;length:number;edges:typeof edges};
    const branches:Branch[]=[];
    for(const edge of edges){
        if(!boundary(edge.from))continue;
        const chain=[edge],seen=new Set([edge.id]);let last=edge;
        while(!boundary(last.to)){
            const next=outgoing.get(last.to)![0];if(seen.has(next.id))break;
            seen.add(next.id);chain.push(next);last=next;
        }
        branches.push({from:edge.from,to:last.to,length:chain.reduce((sum,item)=>sum+item.length,0),edges:chain});
    }
    const pending=new Map<string,number>(),branchOut=new Map<string,Branch[]>(),time=new Map<string,number>();
    for(const branch of branches){pending.set(branch.from,pending.get(branch.from)??0);pending.set(branch.to,(pending.get(branch.to)??0)+1);const list=branchOut.get(branch.from)??[];list.push(branch);branchOut.set(branch.from,list);}
    const queue=[...pending].filter(([,n])=>!n).map(([id])=>id);
    for(let i=0;i<queue.length;i++){
        const id=queue[i],start=time.get(id)??0;
        for(const branch of branchOut.get(id)??[]){time.set(branch.to,Math.max(time.get(branch.to)??0,start+branch.length));const left=pending.get(branch.to)!-1;pending.set(branch.to,left);if(!left)queue.push(branch.to);}
    }
    const total=Math.max(180,...time.values());
    const segments=branches.filter(branch=>pending.get(branch.from)===0&&pending.get(branch.to)===0).flatMap(branch=>{
        const arrival=time.get(branch.to)??0;
        // 时间以画布路程计量：统一速度行驶所需时间就是 length。
        // 与最长输入同步汇入，但不把等待变成减速；出发前由渲染层隐藏数据点。
        const earliest=time.get(branch.from)??0;
        const delayed=arrival-branch.length;
        // 消除相减产生的浮点尾差，让分叉/汇入两侧使用完全相同的交点时刻。
        const start=Math.abs(delayed-earliest)<=Number.EPSILON*Math.max(1,arrival)*8?earliest:delayed,end=arrival;
        let distance=0;
        return branch.edges.map((edge,index)=>{
            const from=start+(end-start)*distance/Math.max(branch.length,0.001);distance+=edge.length;
            const to=index===branch.edges.length-1?end:start+(end-start)*distance/Math.max(branch.length,0.001);
            return {...edge,start:from/total,end:to/total};
        }).filter(edge=>!edge.virtual);
    });
    return {total,segments};
}
