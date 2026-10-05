import {h,button} from '../dom.js';
let current;
export function closeMenu(){current?.();}
export function openMenu(anchor,items,event) {
 closeMenu();const previous=document.activeElement,menu=h('div',{className:'menu',role:'menu'});const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside);current=null;previous?.focus();};const outside=e=>{if(!menu.contains(e.target))close();};
 for(const item of items){if(item===null){menu.append(h('hr'));continue;}menu.append(button(item.label,()=>{close();item.run();},{role:'menuitem',disabled:item.disabled,className:item.danger?'danger-text':''}));}
 document.body.append(menu);const rect=anchor.getBoundingClientRect(),x=event?.clientX??rect.right,y=event?.clientY??rect.bottom;menu.style.left=Math.min(x,innerWidth-menu.offsetWidth-12)+'px';menu.style.top=Math.min(y,innerHeight-menu.offsetHeight-12)+'px';
 menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll('button:not(:disabled)')];if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const index=buttons.indexOf(document.activeElement);buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
 setTimeout(()=>document.addEventListener('pointerdown',outside),0);menu.querySelector('button:not(:disabled)')?.focus();current=close;return close;
}
