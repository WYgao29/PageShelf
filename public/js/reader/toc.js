export function createToc({article,scrollContainer,onActive=()=>{}}) {
 const headings=[...article.querySelectorAll('h2,h3')];let frame,active;
 function update(){frame=null;const boundary=scrollContainer.getBoundingClientRect().top+scrollContainer.clientHeight*.3;let current=headings[0];for(const heading of headings){if(heading.getBoundingClientRect().top<=boundary)current=heading;else break;}if(current?.id!==active){active=current?.id;onActive(active);}}
 const schedule=()=>{frame??=requestAnimationFrame(update);};scrollContainer.addEventListener('scroll',schedule,{passive:true});const observer=new IntersectionObserver(schedule,{root:scrollContainer,rootMargin:'0px 0px -70% 0px'});headings.forEach(heading=>observer.observe(heading));update();
 function jump(id){const heading=headings.find(value=>value.id===id);if(!heading)return;scrollContainer.scrollTo({top:scrollContainer.scrollTop+heading.getBoundingClientRect().top-scrollContainer.getBoundingClientRect().top-12,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});onActive(id);}
 return {jump,destroy(){observer.disconnect();scrollContainer.removeEventListener('scroll',schedule);if(frame)cancelAnimationFrame(frame);}};
}
