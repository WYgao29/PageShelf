import {closeMenu} from './components/menu.js';
export function register(actions) {
 let prefixUntil=0;
 const handler=event=>{if(event.defaultPrevented)return;const key=event.key.toLowerCase(),target=event.target,editable=target.closest('input,textarea,select,[contenteditable=true]'),dialog=document.querySelector('dialog[open]');
  if(event.key==='Escape'){if(document.querySelector('.menu')){event.preventDefault();closeMenu();return;}if(dialog)return;if(editable&&target.id!=='search-input')return;event.preventDefault();actions.escapeSearch();return;}
  if(dialog)return;
  if((event.metaKey||event.ctrlKey)&&key==='k'){event.preventDefault();actions.focusSearch();return;}
  if((event.metaKey||event.ctrlKey)&&event.key==='\\'){event.preventDefault();actions.collapseSidebar();return;}
  if(event.key==='Enter'&&target.id==='search-input'){event.preventDefault();actions.openFocused();return;}
  if(editable||event.metaKey||event.ctrlKey||event.altKey)return;
  if(prefixUntil&&Date.now()<prefixUntil){prefixUntil=0;if(key==='a'){event.preventDefault();actions.selectRoot('');return;}if(/^[1-9]$/.test(key)){event.preventDefault();actions.selectRootByIndex(Number(key)-1);return;}}
  if(key==='g'){prefixUntil=Date.now()+1000;return;}prefixUntil=0;
  if(event.key==='?'||event.shiftKey&&key==='/'){event.preventDefault();actions.help();return;}
  if(event.shiftKey&&key==='r'){event.preventDefault();actions.scan();return;}if(event.shiftKey&&key==='m'){event.preventDefault();actions.openManager();return;}
  const mapping={'/':()=>actions.focusSearch(),j:()=>actions.move(1),k:()=>actions.move(-1),'[':()=>actions.neighbor(-1),']':()=>actions.neighbor(1),v:()=>actions.cycleView(),n:()=>actions.nextHit(event.shiftKey?-1:1),t:()=>actions.cycleTheme()};
  if(event.key==='Enter'&&(target.closest('#list-rows')||target===document.body)){event.preventDefault();actions.openFocused();return;}
  if(mapping[key]){event.preventDefault();mapping[key]();}
 };
 document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler);
}
