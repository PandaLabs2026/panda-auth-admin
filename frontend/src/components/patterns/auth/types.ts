export type LogoutResult = {kind:'navigation'} | {kind:'local';confirmed:boolean;handoff?:string};
/** The owning adapter validates payloads/URLs and preserves its BFF contracts. */
export interface AuthAdapter<Session> {
 session(signal:AbortSignal):Promise<Session|null>;
 status(error:unknown):number;
 logout(session:Session):Promise<LogoutResult>;
 sessionChanged?(session:Session|undefined):void;
}
