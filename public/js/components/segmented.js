import {h,button} from '../dom.js';
export function segmented(label,choices,value,onChange){return h('div',{className:'segmented',role:'group','aria-label':label},choices.map(choice=>button(choice.label,()=>onChange(choice.value),{'aria-pressed':choice.value===value,disabled:choice.disabled})));}
