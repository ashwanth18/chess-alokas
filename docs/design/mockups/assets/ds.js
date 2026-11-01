/* Shared helpers for the mockups. Fake data only: every name is an invented chess pun. */
(function(){
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const params=new URLSearchParams(location.search);
const root=document.documentElement;
const THEMES=['light','dark','sun'];
const sysDark=()=>matchMedia('(prefers-color-scheme:dark)').matches;
function themeLabel(){const t=root.getAttribute('data-theme')||(sysDark()?'dark':'light');return{light:'Light',dark:'Dark',sun:'Sunlight',tv:'TV'}[t]}
function applyTheme(t){if(t)root.setAttribute('data-theme',t);else root.removeAttribute('data-theme');document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=themeLabel())}
function cycleTheme(){const cur=root.getAttribute('data-theme')||(sysDark()?'dark':'light');const n=THEMES[(THEMES.indexOf(cur)+1)%3];store.set('ca-theme',n);applyTheme(n)}
if(!root.hasAttribute('data-theme-fixed'))applyTheme(params.get('theme')||store.get('ca-theme'));
if(params.get('density'))root.setAttribute('data-density',params.get('density'));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/* Split at the patronym marker so the given name leads and the rest wraps as a unit. */
function splitName(n){const m=n.match(/^(.*?)\s((?:bin|binti|a\/l|a\/p)\s.*)$/i);return m?[m[1],m[2]]:[n,'']}
function nameHTML(n,o){o=o||{};const[g,p]=splitName(n);const len=n.length;const cls=o.nofit?'':len>38?'vlong':len>28?'long':'';
 return `<span class="nm ${cls}"><span class="nm-g">${esc(g)}</span>${p?` <span class="nm-p">${esc(p)}</span>`:''}</span>`}
const sq=c=>`<span class="sq ${c}" role="img" aria-label="${c==='w'?'White':'Black'}"></span>`;
const MARK='<svg viewBox="0 0 16 16" aria-hidden="true"><rect x=".75" y=".75" width="14.5" height="14.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="1" width="7" height="7" fill="currentColor"/><rect x="1" y="8" width="7" height="7" fill="currentColor"/></svg>';
document.addEventListener('click',e=>{if(e.target.closest('[data-cycle-theme]'))cycleTheme()});
document.addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('[data-mark]').forEach(e=>e.insertAdjacentHTML('afterbegin',MARK));applyTheme(root.getAttribute('data-theme'))});

/* The field. All invented. */
const U12=['Puteri Alekhine Damia binti Queen Gambit','Puteri Alekhine Damia binti Queen Indian','Kavitha Zugzwang a/p Fianchetto Rajaratnam','Tan Zwischen Zug','Muhammad Caro Kann bin Sicilian Najdorf','Lim Gambit Ling','Arjun Pirc a/l Grunfeld Subramaniam','Nur Sicilia Najdorfah binti Mohd Endgame Tablebase','Chong Rook Hao','Wan Rookiah Fianchetta binti Wan Back Rank','Ng Pawn Mei','Priya Benoni a/p Philidor','Goh En Passant','Ahmad Zugzwang Haziq bin Pawn Storm','Wong Fork Jia','Deepa Blitz a/p Sveshnikov'];
const U18=['Tengku Gambit Iskandar bin Tengku Kingside Castle','Vikram Tempo a/l Zwischenzug Krishnan','Yap Pin Yi','Siti Bishopah Kasparina binti En Passant','Lee Skewer Xuan','Dayang Nimzo Indiana binti Awang Opposite Bishops','Teoh Rook Lift','Harish Catalan a/l Tartakower','Mohd Scandinavian Faris bin Stalemate','Ong Bishop Pair','Sharifah Petroff Aina binti Syed Perpetual Check','Low Knight Outpost','Thivya Dragon a/p Levenfish','Foo Passed Pawn','Aiman Ponziani bin Greek Gift','Kok Castling Long','Rani Trompowsky a/p Bogo Indian','Seah Isolated Queen Pawn','Hafiz Vienna bin Smothered Mate','Cheah Hanging Pawns'];
function rng(seed){let s=seed;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
const schools=['SK Pretend Heights','SJK(C) Imaginary Bay','SJK(T) Nowhere Road','SMK Fictional Jaya','Sekolah Tiada Di Peta'];
function field(){const mk=(arr,sec,base)=>arr.map((name,i)=>({id:sec+i,name,sec,no:base+i+1,rating:1880-i*37-(sec==='U12'?420:0),pts:0,hist:[],col:[],school:schools[i%5]}));
 return{U12:mk(U12,'U12',0),U18:mk(U18,'U18',16)}}
/* Toy pairing for the mock only: score groups, adjacent pairing, avoids repeats, balances colours. Not the real engine. */
function pairSection(players){const list=[...players].sort((a,b)=>b.pts-a.pts||a.no-b.no);const used=new Set();const out=[];
 for(let i=0;i<list.length;i++){const a=list[i];if(used.has(a.id))continue;let b=null;
  for(let j=i+1;j<list.length;j++){const c=list[j];if(!used.has(c.id)&&!a.hist.some(h=>h.opp===c.id)){b=c;break}}
  if(!b){for(let j=i+1;j<list.length;j++){if(!used.has(list[j].id)){b=list[j];break}}}
  if(!b)break;used.add(a.id);used.add(b.id);
  const wa=a.col.filter(x=>x==='w').length,wb=b.col.filter(x=>x==='w').length;out.push(wa<=wb?[a,b]:[b,a])}
 return out}
function applyResult(w,b,r){const sw=(r==='1-0'||r==='1F')?1:(r==='0-1'||r==='0F'||r==='0-0')?0:.5;const sb=r==='0-0'?0:1-sw;w.pts+=sw;b.pts+=sb;w.col.push('w');b.col.push('b');w.hist.push({opp:b.id,res:sw,col:'w'});b.hist.push({opp:w.id,res:sb,col:'b'})}
function simulate(rounds,seed){const f=field();const r=rng(seed||25);const hist=[];
 for(let k=0;k<rounds;k++){const boards=[...pairSection(f.U12).map(p=>({p,sec:'U12'})),...pairSection(f.U18).map(p=>({p,sec:'U18'}))];const games=[];
  boards.forEach((x,i)=>{const[w,b]=x.p;const d=w.rating-b.rating;const v=r()+d/2400;const res=v>.62?'1-0':v<.34?'0-1':'1/2';games.push({bd:i+1,w,b,sec:x.sec,res,wp:w.pts,bp:b.pts})});
  games.forEach(g=>applyResult(g.w,g.b,g.res));hist.push(games)}
 return{f,all:[...f.U12,...f.U18],hist}}
function newRound(s){return[...pairSection(s.f.U12).map(p=>({p,sec:'U12'})),...pairSection(s.f.U18).map(p=>({p,sec:'U18'}))].map((x,i)=>({bd:i+1,w:x.p[0],b:x.p[1],sec:x.sec,res:null,wp:x.p[0].pts,bp:x.p[1].pts,src:null,state:null}))}
const pts=v=>{const i=Math.floor(v),h=v-i>0;return h?(i===0?'½':i+'½'):String(i)};
const resText={'1-0':'1 – 0','0-1':'0 – 1','1/2':'½ – ½','1F':'1F – 0F','0F':'0F – 1F','0-0':'0F – 0F'};
const resSpoken={'1-0':'White won','0-1':'Black won','1/2':'Draw','1F':'White wins by forfeit','0F':'Black wins by forfeit','0-0':'Both absent'};
window.CA={SEED:25,store,params,esc,splitName,nameHTML,sq,MARK,simulate,newRound,pairSection,applyResult,pts,resText,resSpoken,cycleTheme,field};
})();
