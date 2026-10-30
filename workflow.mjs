export function canRun({pretestSubmitted=false,prediction=''}) {
 return pretestSubmitted===true && typeof prediction==='string' && prediction.trim().length>0;
}
export function runPayload(p,prediction){
 const {r,x0,logDelta,steps}=p;
 if(!Number.isFinite(r)||r<3.3||r>4 ||
    !Number.isFinite(x0)||x0<.01||x0>.85 ||
    !Number.isInteger(logDelta)||logDelta< -14||logDelta> -3 ||
    !Number.isInteger(steps)||steps<20||steps>300||steps%10!==0)
    throw new Error('参数不在已验证的实验范围内');
 if(typeof prediction!=='string'||!prediction.trim())throw new Error('请先填写预测');
 return {experiment:'sensitivity',prediction:prediction.trim(),params:{r,x0,logDelta,steps}};
}
export function selectPlotPoint(plot,seriesIndex,pointIndex){
 const point=plot?.series?.[seriesIndex]?.points?.[pointIndex];
 if(!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1]))return null;
 return {seriesIndex,pointIndex,x:point[0],y:point[1]};
}
