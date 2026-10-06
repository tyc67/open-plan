import { useEffect, useState } from 'react';

const validColor=value=>/^#[0-9a-f]{6}$/i.test(value);
const normalizedColor=value=>/^#[0-9a-f]{3}$/i.test(value)?'#'+value.slice(1).split('').map(c=>c+c).join(''):validColor(value)?value:'#808080';
export default function FurnitureAppearance({nameLocked,item,onPatch}) {
  const [name,setName]=useState(item.name);
  const [color,setColor]=useState(()=>normalizedColor(item.color));
  useEffect(()=>{setName(item.name);setColor(normalizedColor(item.color));},[item.id,item.name,item.color]);
  function saveName(){if(nameLocked)return;const next=name.trim();if(next&&next!==item.name)onPatch({name:next});setName(next||item.name);}
  function saveColor(){const next=color.trim();if(validColor(next)){const value=next.toLowerCase();setColor(value);if(value!==normalizedColor(item.color).toLowerCase())onPatch({color:value});}else setColor(normalizedColor(item.color));}
  function finish(e,reset){if(e.nativeEvent.isComposing)return;if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.preventDefault();reset();}}
  return <>
    <label>名稱<div><input type="text" disabled={nameLocked} aria-label="家具名稱" value={name} maxLength={80} onChange={e=>setName(e.target.value)} onBlur={saveName} onKeyDown={e=>finish(e,()=>setName(item.name))}/></div></label>
    <label>顏色<div>
      <input type="color" aria-label="家具顏色" value={validColor(color)?color:normalizedColor(item.color)} onChange={e=>setColor(e.target.value)} onBlur={saveColor}/>
      <input type="text" aria-label="家具顏色代碼" value={color} maxLength={7} spellCheck={false} onChange={e=>setColor(e.target.value)} onBlur={saveColor} onKeyDown={e=>finish(e,()=>setColor(normalizedColor(item.color)))}/>
    </div></label>
  </>;
}
