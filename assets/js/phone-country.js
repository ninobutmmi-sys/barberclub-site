/**
 * BarberClub — Country phone selector with search
 * Shared between Meylan & Grenoble booking pages
 *
 * Usage:
 *   initPhoneCountry('#phoneCountry', '#phone');
 *   getFullPhone('#phoneCountry', '#phone'); // → "+33612345678"
 */

// Top countries (Grenoble area) shown first, then all others alphabetically
const TOP_COUNTRIES = [
  ['FR','France','🇫🇷','+33'],['CH','Suisse','🇨🇭','+41'],['IT','Italie','🇮🇹','+39'],['BE','Belgique','🇧🇪','+32'],
  ['DE','Allemagne','🇩🇪','+49'],['ES','Espagne','🇪🇸','+34'],['GB','Royaume-Uni','🇬🇧','+44'],['PT','Portugal','🇵🇹','+351'],
  ['NL','Pays-Bas','🇳🇱','+31'],['MA','Maroc','🇲🇦','+212'],['DZ','Algérie','🇩🇿','+213'],['TN','Tunisie','🇹🇳','+216'],
];

const ALL_COUNTRIES = [
  ['AD','Andorre','🇦🇩','+376'],['AE','Émirats arabes unis','🇦🇪','+971'],['AF','Afghanistan','🇦🇫','+93'],['AG','Antigua-et-Barbuda','🇦🇬','+1268'],
  ['AL','Albanie','🇦🇱','+355'],['AM','Arménie','🇦🇲','+374'],['AO','Angola','🇦🇴','+244'],['AR','Argentine','🇦🇷','+54'],
  ['AT','Autriche','🇦🇹','+43'],['AU','Australie','🇦🇺','+61'],['AZ','Azerbaïdjan','🇦🇿','+994'],['BA','Bosnie-Herzégovine','🇧🇦','+387'],
  ['BB','Barbade','🇧🇧','+1246'],['BD','Bangladesh','🇧🇩','+880'],['BF','Burkina Faso','🇧🇫','+226'],['BG','Bulgarie','🇧🇬','+359'],
  ['BH','Bahreïn','🇧🇭','+973'],['BI','Burundi','🇧🇮','+257'],['BJ','Bénin','🇧🇯','+229'],['BN','Brunei','🇧🇳','+673'],
  ['BO','Bolivie','🇧🇴','+591'],['BR','Brésil','🇧🇷','+55'],['BS','Bahamas','🇧🇸','+1242'],['BT','Bhoutan','🇧🇹','+975'],
  ['BW','Botswana','🇧🇼','+267'],['BY','Biélorussie','🇧🇾','+375'],['BZ','Belize','🇧🇿','+501'],['CA','Canada','🇨🇦','+1'],
  ['CD','RD Congo','🇨🇩','+243'],['CF','Centrafrique','🇨🇫','+236'],['CG','Congo','🇨🇬','+242'],['CI','Côte d\'Ivoire','🇨🇮','+225'],
  ['CL','Chili','🇨🇱','+56'],['CM','Cameroun','🇨🇲','+237'],['CN','Chine','🇨🇳','+86'],['CO','Colombie','🇨🇴','+57'],
  ['CR','Costa Rica','🇨🇷','+506'],['CU','Cuba','🇨🇺','+53'],['CV','Cap-Vert','🇨🇻','+238'],['CY','Chypre','🇨🇾','+357'],
  ['CZ','Tchéquie','🇨🇿','+420'],['DJ','Djibouti','🇩🇯','+253'],['DK','Danemark','🇩🇰','+45'],['DM','Dominique','🇩🇲','+1767'],
  ['DO','Rép. dominicaine','🇩🇴','+1809'],['EC','Équateur','🇪🇨','+593'],['EE','Estonie','🇪🇪','+372'],['EG','Égypte','🇪🇬','+20'],
  ['ER','Érythrée','🇪🇷','+291'],['ET','Éthiopie','🇪🇹','+251'],['FI','Finlande','🇫🇮','+358'],['FJ','Fidji','🇫🇯','+679'],
  ['GA','Gabon','🇬🇦','+241'],['GD','Grenade','🇬🇩','+1473'],['GE','Géorgie','🇬🇪','+995'],['GH','Ghana','🇬🇭','+233'],
  ['GM','Gambie','🇬🇲','+220'],['GN','Guinée','🇬🇳','+224'],['GQ','Guinée équatoriale','🇬🇶','+240'],['GR','Grèce','🇬🇷','+30'],
  ['GT','Guatemala','🇬🇹','+502'],['GW','Guinée-Bissau','🇬🇼','+245'],['GY','Guyana','🇬🇾','+592'],['HN','Honduras','🇭🇳','+504'],
  ['HR','Croatie','🇭🇷','+385'],['HT','Haïti','🇭🇹','+509'],['HU','Hongrie','🇭🇺','+36'],['ID','Indonésie','🇮🇩','+62'],
  ['IE','Irlande','🇮🇪','+353'],['IL','Israël','🇮🇱','+972'],['IN','Inde','🇮🇳','+91'],['IQ','Irak','🇮🇶','+964'],
  ['IR','Iran','🇮🇷','+98'],['IS','Islande','🇮🇸','+354'],['JM','Jamaïque','🇯🇲','+1876'],['JO','Jordanie','🇯🇴','+962'],
  ['JP','Japon','🇯🇵','+81'],['KE','Kenya','🇰🇪','+254'],['KG','Kirghizistan','🇰🇬','+996'],['KH','Cambodge','🇰🇭','+855'],
  ['KM','Comores','🇰🇲','+269'],['KR','Corée du Sud','🇰🇷','+82'],['KW','Koweït','🇰🇼','+965'],['KZ','Kazakhstan','🇰🇿','+7'],
  ['LA','Laos','🇱🇦','+856'],['LB','Liban','🇱🇧','+961'],['LC','Sainte-Lucie','🇱🇨','+1758'],['LI','Liechtenstein','🇱🇮','+423'],
  ['LK','Sri Lanka','🇱🇰','+94'],['LR','Libéria','🇱🇷','+231'],['LS','Lesotho','🇱🇸','+266'],['LT','Lituanie','🇱🇹','+370'],
  ['LU','Luxembourg','🇱🇺','+352'],['LV','Lettonie','🇱🇻','+371'],['LY','Libye','🇱🇾','+218'],['MC','Monaco','🇲🇨','+377'],
  ['MD','Moldavie','🇲🇩','+373'],['ME','Monténégro','🇲🇪','+382'],['MG','Madagascar','🇲🇬','+261'],['MK','Macédoine du Nord','🇲🇰','+389'],
  ['ML','Mali','🇲🇱','+223'],['MM','Myanmar','🇲🇲','+95'],['MN','Mongolie','🇲🇳','+976'],['MR','Mauritanie','🇲🇷','+222'],
  ['MT','Malte','🇲🇹','+356'],['MU','Maurice','🇲🇺','+230'],['MV','Maldives','🇲🇻','+960'],['MW','Malawi','🇲🇼','+265'],
  ['MX','Mexique','🇲🇽','+52'],['MY','Malaisie','🇲🇾','+60'],['MZ','Mozambique','🇲🇿','+258'],['NA','Namibie','🇳🇦','+264'],
  ['NE','Niger','🇳🇪','+227'],['NG','Nigéria','🇳🇬','+234'],['NI','Nicaragua','🇳🇮','+505'],['NO','Norvège','🇳🇴','+47'],
  ['NP','Népal','🇳🇵','+977'],['NZ','Nouvelle-Zélande','🇳🇿','+64'],['OM','Oman','🇴🇲','+968'],['PA','Panama','🇵🇦','+507'],
  ['PE','Pérou','🇵🇪','+51'],['PG','Papouasie-Nouvelle-Guinée','🇵🇬','+675'],['PH','Philippines','🇵🇭','+63'],['PK','Pakistan','🇵🇰','+92'],
  ['PL','Pologne','🇵🇱','+48'],['QA','Qatar','🇶🇦','+974'],['RO','Roumanie','🇷🇴','+40'],['RS','Serbie','🇷🇸','+381'],
  ['RU','Russie','🇷🇺','+7'],['RW','Rwanda','🇷🇼','+250'],['SA','Arabie saoudite','🇸🇦','+966'],['SC','Seychelles','🇸🇨','+248'],
  ['SD','Soudan','🇸🇩','+249'],['SE','Suède','🇸🇪','+46'],['SG','Singapour','🇸🇬','+65'],['SI','Slovénie','🇸🇮','+386'],
  ['SK','Slovaquie','🇸🇰','+421'],['SL','Sierra Leone','🇸🇱','+232'],['SM','Saint-Marin','🇸🇲','+378'],['SN','Sénégal','🇸🇳','+221'],
  ['SO','Somalie','🇸🇴','+252'],['SR','Suriname','🇸🇷','+597'],['SV','Salvador','🇸🇻','+503'],['SY','Syrie','🇸🇾','+963'],
  ['TD','Tchad','🇹🇩','+235'],['TG','Togo','🇹🇬','+228'],['TH','Thaïlande','🇹🇭','+66'],['TJ','Tadjikistan','🇹🇯','+992'],
  ['TL','Timor oriental','🇹🇱','+670'],['TM','Turkménistan','🇹🇲','+993'],['TO','Tonga','🇹🇴','+676'],['TR','Turquie','🇹🇷','+90'],
  ['TT','Trinité-et-Tobago','🇹🇹','+1868'],['TZ','Tanzanie','🇹🇿','+255'],['UA','Ukraine','🇺🇦','+380'],['UG','Ouganda','🇺🇬','+256'],
  ['US','États-Unis','🇺🇸','+1'],['UY','Uruguay','🇺🇾','+598'],['UZ','Ouzbékistan','🇺🇿','+998'],['VE','Venezuela','🇻🇪','+58'],
  ['VN','Vietnam','🇻🇳','+84'],['YE','Yémen','🇾🇪','+967'],['ZA','Afrique du Sud','🇿🇦','+27'],['ZM','Zambie','🇿🇲','+260'],
  ['ZW','Zimbabwe','🇿🇼','+263'],
];

// Filter out top countries from ALL to avoid duplicates
const TOP_CODES = new Set(TOP_COUNTRIES.map(c => c[0]));
const OTHER_COUNTRIES = ALL_COUNTRIES.filter(c => !TOP_CODES.has(c[0]));

/**
 * Initialize a phone country selector
 * @param {string} containerId - CSS selector for the wrapper div (replaces <select>)
 * @param {string} phoneInputId - CSS selector for the phone <input>
 */
function initPhoneCountry(containerId, phoneInputId) {
  const container = document.querySelector(containerId);
  const phoneInput = document.querySelector(phoneInputId);
  if (!container || !phoneInput) return;

  // State
  let selected = TOP_COUNTRIES[0]; // France default
  let isOpen = false;

  // Build DOM
  container.innerHTML = '';
  container.style.position = 'relative';

  // Selected button
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pcs-btn';
  btn.innerHTML = `<span class="pcs-flag">${selected[2]}</span><span class="pcs-dial">${selected[3]}</span><span class="pcs-arrow">▾</span>`;
  container.appendChild(btn);

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'pcs-dropdown';
  dropdown.style.display = 'none';
  container.appendChild(dropdown);

  // Search input
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'pcs-search';
  search.placeholder = 'Rechercher un pays...';
  search.autocomplete = 'off';
  dropdown.appendChild(search);

  // List
  const list = document.createElement('div');
  list.className = 'pcs-list';
  dropdown.appendChild(list);

  function renderList(filter) {
    const q = (filter || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    list.innerHTML = '';

    const matchCountry = (c) => {
      if (!q) return true;
      const name = c[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return name.includes(q) || c[3].includes(q) || c[0].toLowerCase().includes(q);
    };

    const topFiltered = TOP_COUNTRIES.filter(matchCountry);
    const otherFiltered = OTHER_COUNTRIES.filter(matchCountry);

    if (topFiltered.length > 0) {
      topFiltered.forEach(c => list.appendChild(makeItem(c)));
      if (otherFiltered.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'pcs-separator';
        list.appendChild(sep);
      }
    }
    otherFiltered.forEach(c => list.appendChild(makeItem(c)));

    if (topFiltered.length === 0 && otherFiltered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pcs-empty';
      empty.textContent = 'Aucun résultat';
      list.appendChild(empty);
    }
  }

  function makeItem(c) {
    const item = document.createElement('div');
    item.className = 'pcs-item' + (c[0] === selected[0] ? ' pcs-item-active' : '');
    item.innerHTML = `<span class="pcs-flag">${c[2]}</span><span class="pcs-name">${c[1]}</span><span class="pcs-dial">${c[3]}</span>`;
    item.addEventListener('click', () => {
      selected = c;
      btn.innerHTML = `<span class="pcs-flag">${c[2]}</span><span class="pcs-dial">${c[3]}</span><span class="pcs-arrow">▾</span>`;
      close();
      phoneInput.focus();
    });
    return item;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    dropdown.style.display = '';
    search.value = '';
    renderList('');
    // Scroll to selected
    requestAnimationFrame(() => {
      const active = list.querySelector('.pcs-item-active');
      if (active) active.scrollIntoView({ block: 'center' });
      search.focus();
    });
  }

  function close() {
    isOpen = false;
    dropdown.style.display = 'none';
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isOpen ? close() : open();
  });

  search.addEventListener('input', () => renderList(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) close();
  });

  // Store getter on container for getFullPhone
  container._getDialCode = () => selected[3];
}

/**
 * Get full international phone number from country selector + input
 */
function getFullPhone(containerId, inputId) {
  const container = document.querySelector(containerId);
  const input = document.querySelector(inputId);
  if (!container || !input || !container._getDialCode) return '';
  const dial = container._getDialCode();
  let num = input.value.trim().replace(/[\s.-]/g, '');
  if (!num) return '';
  if (num.startsWith('0')) num = num.substring(1);
  return dial + num;
}
