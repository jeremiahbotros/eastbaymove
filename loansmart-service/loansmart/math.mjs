export function calculate(v) {
  const keys=['price','down','rate','term','tax','insurance','hoa','pmi','closing','income','debts','savings','reserve'];
  for(const k of keys) if(!Number.isFinite(v[k]) || v[k]<0) throw new Error('Enter a valid, non-negative number for every field.');
  if(v.price<=0 || v.down>v.price || ![15,20,30].includes(v.term) || v.rate>25 || v.tax>10 || v.pmi>10 || v.closing>20) throw new Error('Check the home price, down payment, term and percentage assumptions.');
  const loan=v.price-v.down, r=v.rate/1200, n=v.term*12;
  const pi=loan===0?0:r===0?loan/n:loan*r/(1-Math.pow(1+r,-n));
  const tax=v.price*v.tax/1200, insurance=v.insurance/12, pmi=loan>0 && v.down/v.price<.2?loan*v.pmi/1200:0;
  const payment=pi+tax+insurance+v.hoa+pmi, closing=v.price*v.closing/100, cash=v.down+closing;
  const available=Math.max(0,v.savings-v.reserve), gap=Math.max(0,cash-available);
  return {loan,pi,tax,insurance,pmi,payment,closing,cash,gap,available,dti:v.income>0?(payment+v.debts)/(v.income/12)*100:null};
}
export function validateApplication(x, {submit=true}={}) {
  if(!x || typeof x!=='object' || Array.isArray(x)) throw new Error('Invalid application.');
  const out={};
  for(const k of ['firstName','lastName','city','employment','timeline']) {
    if(typeof x[k]!=='string' || (submit && !x[k].trim()) || x[k].length>100) throw new Error('Complete all application fields.');
    out[k]=x[k].trim();
  }
  if(!['Employed','Self-employed','Retired','Other'].includes(out.employment) || !['0–3 months','3–6 months','6+ months','Exploring'].includes(out.timeline)) throw new Error('Choose valid application options.');
  for(const k of ['price','down','income','debts','assets']) {
    if(typeof x[k]!=='number' || !Number.isFinite(x[k]) || x[k]<0 || x[k]>100000000) throw new Error('Enter valid financial amounts.');
    out[k]=x[k];
  }
  if((submit && (out.price<=0 || x.consent!==true)) || out.down>out.price) throw new Error('Check your price and down payment, and confirm the submission acknowledgment.');
  out.consent=x.consent===true;
  return out;
}
