/**
 * Import automatique des factures depuis Gmail vers l'appli Notes de frais.
 * A coller dans Google Apps Script (script.google.com), pas dans l'appli.
 *
 * Sources lues (2026 uniquement) :
 *   - Esso (Certas)  : PDF joint "Votre reçu"            -> Carburant
 *   - Free Mobile    : texte du mail "facture disponible" -> Télécom
 *   - Freebox        : texte du mail "facture disponible" -> Télécom
 *   - Anthropic      : texte du mail Stripe "Your receipt" -> Autre
 *
 * Réglages (Paramètres du projet > Propriétés du script) :
 *   SA_KEY : contenu complet du fichier JSON de la clé de compte de service Firebase
 *   UID    : identifiant utilisateur (Firebase > Authentication > Utilisateurs)
 *
 * Fonctions à lancer :
 *   testSansEcrire : lit les mails et AFFICHE ce qui serait ajouté (rien n'est écrit)
 *   importer       : ajoute les tickets dans la base (à brancher sur un déclencheur quotidien)
 */

const PROJECT_ID = 'notes-frais-fac8e';
const ANNEE = '2026';
const LABEL = 'NotesFrais-importé'; // etiquette posée sur les mails déjà traités

const SOURCES = [
  { nom: 'Esso',        cat: 'fuel',    pdf: true,
    query: 'from:essonoreply@club-certas.com has:attachment', parse: parseEsso },
  { nom: 'Free Mobile', cat: 'telecom', place: 'Free Mobile',
    query: 'from:freemobile@free-mobile.fr subject:facture', parse: parseFreeMobile },
  { nom: 'Freebox',     cat: 'telecom', place: 'Freebox',
    query: 'from:info-abonne@freetelecom.fr subject:facture', parse: parseFreebox },
  { nom: 'Anthropic',   cat: 'other',   place: 'Anthropic',
    query: 'subject:"Your receipt from Anthropic"', parse: parseAnthropic },
];

function testSansEcrire(){ run_(true); }
function importer(){ run_(false); }

function run_(dry){
  const existants = lireExistants_();
  const label = dry ? null : (GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL));
  let ajoutes = 0;
  for(const src of SOURCES){
    const q = src.query + ' after:' + ANNEE + '/01/01 -label:' + LABEL;
    for(const thread of GmailApp.search(q, 0, 50)){
      let traite = true;
      for(const msg of thread.getMessages()){
        let r = null;
        try{
          r = src.pdf ? lireEsso_(msg) : src.parse(msg.getPlainBody());
        }catch(e){ Logger.log('ERREUR ' + src.nom + ' : ' + e); traite = false; continue; }
        if(!r){ Logger.log('ILLISIBLE ' + src.nom + ' : ' + msg.getSubject()); traite = false; continue; }
        if(r.date.slice(0,4) !== ANNEE) continue;
        const recu = r.receiptNo || ('mail:' + msg.getId());
        const doublon = existants.numeros.has(recu) ||
          existants.liste.some(e=> !e.receiptNo && e.date === r.date && Math.abs(e.amount - r.amount) < 0.005);
        if(doublon){ Logger.log('DEJA PRESENT ' + src.nom + ' ' + r.date + ' ' + r.amount); continue; }
        const ticket = {
          id: 'mail_' + msg.getId(),
          cat: src.cat, amount: r.amount, date: r.date,
          place: r.place || src.place || '', address: r.address || '',
          receiptNo: recu, photo: null
        };
        Logger.log((dry ? 'A AJOUTER ' : 'AJOUT ') + JSON.stringify(ticket));
        if(!dry){ ecrireTicket_(ticket); existants.numeros.add(recu); existants.liste.push({date:r.date, amount:r.amount, receiptNo:recu}); }
        ajoutes++;
      }
      if(!dry && traite) thread.addLabel(label);
    }
  }
  Logger.log((dry ? 'Simulation : ' : 'Termine : ') + ajoutes + ' ticket(s)');
}

// ---------- Lecture des mails ----------
const MOIS = {janvier:1,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,septembre:9,octobre:10,novembre:11,decembre:12,
  january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};

function iso_(j, m, a){ return a + '-' + String(m).padStart(2,'0') + '-' + String(j).padStart(2,'0'); }
function mois_(nom){ return MOIS[nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')]; }
function nombre_(s){ return parseFloat(String(s).replace(/\s/g,'').replace(',', '.')); }

function parseFreeMobile(t){
  const d = t.match(/facture mobile Free du (\d{2})-(\d{2})-(\d{4})/);
  const m = t.match(/montant de\s*([\d\s.,]+?)\s*€/);
  return d && m ? { date: iso_(d[1], d[2], d[3]), amount: nombre_(m[1]) } : null;
}
function parseFreebox(t){
  const d = t.match(/facture Freebox du (\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/);
  const m = t.match(/montant de\s*([\d\s.,]+?)\s*€/);
  const mo = d && mois_(d[2]);
  return d && m && mo ? { date: iso_(d[1], mo, d[3]), amount: nombre_(m[1]) } : null;
}
function parseAnthropic(t){
  const m = t.match(/€\s*([\d.,]+)\s*Paid on ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  const n = t.match(/Receipt #(\d{4}-\d{4})/);
  const mo = m && mois_(m[2]);
  return m && mo ? { date: iso_(m[3], mo, m[4]), amount: nombre_(m[1]), receiptNo: n ? 'anthropic:' + n[1] : null } : null;
}

// Esso : le montant est dans le PDF joint, lu par la conversion en document Google (service Drive).
function lireEsso_(msg){
  for(const pj of msg.getAttachments()){
    if(pj.getContentType() !== 'application/pdf') continue;
    const f = Drive.Files.create({name:'tmp-recu-esso', mimeType:'application/vnd.google-apps.document'}, pj, {ocrLanguage:'fr'});
    let texte;
    try{ texte = DocumentApp.openById(f.id).getBody().getText(); }
    finally{ Drive.Files.remove(f.id); }
    const r = parseEsso(texte);
    if(r) return r;
  }
  return null;
}
function parseEsso(texte){
  const lignes = texte.split(/\r?\n/).map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean);
  const d = texte.match(/Date\s+(\d{2})-(\d{2})-(\d{4})/);
  const m = texte.match(/TOT\s*TTC\s*\S{0,2}\s*(\d+[.,]\d{2})/);
  const n = texte.match(/No\.?\s*ticket\s+(\d+)/);
  if(!d || !m) return null;
  return {
    date: iso_(d[1], d[2], d[3]), amount: nombre_(m[1]),
    place: lignes[0] && !/^(TVA|Date)/i.test(lignes[0]) ? lignes[0] : '',
    address: lignes[1] && /^\d{5}\s/.test(lignes[1]) ? lignes[1] : '',
    receiptNo: n ? n[1] : null
  };
}

// ---------- Firestore (API REST, compte de service) ----------
function jeton_(){
  const cle = JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_KEY'));
  const b64 = o => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/,'');
  const now = Math.floor(Date.now()/1000);
  const entete = b64({alg:'RS256', typ:'JWT'});
  const corps = b64({iss:cle.client_email, scope:'https://www.googleapis.com/auth/datastore',
    aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600});
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(entete + '.' + corps, cle.private_key)).replace(/=+$/,'');
  const rep = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {method:'post',
    payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: entete + '.' + corps + '.' + sig}});
  return JSON.parse(rep.getContentText()).access_token;
}

function base_(){
  const uid = PropertiesService.getScriptProperties().getProperty('UID');
  return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/users/' + uid;
}

let JETON = null;
function auth_(){ if(!JETON) JETON = jeton_(); return {Authorization:'Bearer ' + JETON}; }

// Tickets deja dans la base (date, montant, numero) pour eviter les doublons.
function lireExistants_(){
  const rep = UrlFetchApp.fetch(base_() + ':runQuery', {method:'post', contentType:'application/json', headers:auth_(),
    payload: JSON.stringify({structuredQuery:{from:[{collectionId:'tickets'}],
      select:{fields:[{fieldPath:'date'},{fieldPath:'amount'},{fieldPath:'receiptNo'}]}}})});
  const liste = [], numeros = new Set();
  for(const r of JSON.parse(rep.getContentText())){
    if(!r.document) continue;
    const f = r.document.fields || {};
    const e = {
      date: f.date && f.date.stringValue,
      amount: f.amount ? Number(f.amount.doubleValue !== undefined ? f.amount.doubleValue : f.amount.integerValue) : NaN,
      receiptNo: f.receiptNo && f.receiptNo.stringValue
    };
    liste.push(e);
    if(e.receiptNo) numeros.add(e.receiptNo);
  }
  return {liste, numeros};
}

function ecrireTicket_(t){
  const champs = {
    id:{stringValue:t.id}, cat:{stringValue:t.cat}, amount:{doubleValue:t.amount}, date:{stringValue:t.date},
    place:{stringValue:t.place}, address:{stringValue:t.address}, receiptNo:{stringValue:t.receiptNo}, photo:{nullValue:null}
  };
  UrlFetchApp.fetch(base_() + '/tickets/' + t.id, {method:'patch', contentType:'application/json', headers:auth_(),
    payload: JSON.stringify({fields: champs})});
}
