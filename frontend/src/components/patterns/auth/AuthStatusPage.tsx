import { useEffect,useId,useRef,useState,type ReactNode } from 'react';
// Presentation only: requests and navigation are never delayed by this timer.
const quietRevealDelayMs=800;
export default function AuthStatusPage({title,description,children,busy=false,brand,deferStatus=false,reserveActions=false,presentation}:{title:string;description?:string;children?:ReactNode;busy?:boolean;brand:ReactNode;deferStatus?:boolean;reserveActions?:boolean;presentation?:'quiet'}) {
 const heading=useRef<HTMLHeadingElement>(null),id=useId();
 const quiet=busy&&presentation==='quiet';
 useEffect(() => {if(!quiet&&!deferStatus)heading.current?.focus();},[title,deferStatus,quiet]);
 if(quiet)return <QuietStatus description={description??title}>{children}</QuietStatus>;
 return <main className="grid min-h-svh place-items-center bg-background p-4 sm:p-6">
  <section aria-labelledby={id} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">
   <div className="mb-8">{brand}</div>
   <h1 id={id} ref={heading} tabIndex={-1} aria-hidden={deferStatus||undefined} className={`${deferStatus?'invisible ':''}text-xl font-semibold tracking-tight outline-none`}>{title}</h1>
   <p aria-hidden={deferStatus||undefined} role={busy?'status':'alert'} className={`${deferStatus?'invisible ':''}${reserveActions?'min-h-12 ':''}mt-3 text-sm leading-6 text-muted-foreground`}>{description??title}</p>
   {(children||reserveActions)&&<div className={`${reserveActions?'min-h-9 ':''}mt-6 flex flex-col gap-3`}>{children}</div>}
  </section>
 </main>;
}

function QuietStatus({description,children}:{description:string;children?:ReactNode}) {
 const [revealed,setRevealed]=useState(false);
 useEffect(()=>{
  const timer=window.setTimeout(()=>setRevealed(true),quietRevealDelayMs);
  return()=>window.clearTimeout(timer);
 },[]);
 return <main className="grid min-h-svh place-items-center bg-background p-4 sm:p-6">
  <div className={revealed?'w-full max-w-sm text-center':'sr-only'}>
   <p role="status" className="text-sm leading-6 text-muted-foreground">{description}</p>
   {children&&<div className="mt-6 flex flex-col gap-3" hidden={!revealed}>{children}</div>}
  </div>
 </main>;
}
