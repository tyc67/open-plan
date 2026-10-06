export function roomArea(poly) {
  return Math.abs(poly.reduce((sum,[x,y],i)=>{const [nx,ny]=poly[(i+1)%poly.length];return sum+x*ny-nx*y;},0))/2e6;
}
export function roomPerimeter(poly) {
  return poly.reduce((sum,[x,y],i)=>{const [nx,ny]=poly[(i+1)%poly.length];return sum+Math.hypot(nx-x,ny-y);},0)/1000;
}
export function containsPoint(poly,x,y) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const [ax,ay]=poly[j],[bx,by]=poly[i];
    const cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
    if(Math.abs(cross)<1e-6&&x>=Math.min(ax,bx)&&x<=Math.max(ax,bx)&&y>=Math.min(ay,by)&&y<=Math.max(ay,by))return true;
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside;
}
