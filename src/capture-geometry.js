// The preview and saved photo use this exact same portrait crop.
export function portraitCrop(width,height){
 if(!(width>0&&height>0))throw new Error('Camera is not ready yet.');
 const ratio=3/4,w=Math.min(width,height*ratio),h=w/ratio;
 return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
export function portraitFrame(width,height){const w=Math.max(1,Math.min(width,height*3/4));return {width:w,height:w*4/3};}
