const {
  repairTruncatedFrenchMobile,
  normalizePhone,
  isFrenchMobile,
  isFrenchPhone,
  formatPhoneInternational,
} = require('../../../src/utils/phone');
const { normalizePhoneFields } = require('../../../src/middleware/normalizePhone');

describe('repairTruncatedFrenchMobile', () => {
  it('répare un 06 saisi sans le 0', () => {
    expect(repairTruncatedFrenchMobile('+637911292')).toBe('+33637911292');
  });

  it('répare un 07 saisi sans le 0', () => {
    expect(repairTruncatedFrenchMobile('+787876377')).toBe('+33787876377');
  });

  it('ne touche pas à un vrai numéro australien', () => {
    // +61 suivi de 9 chiffres = 11 chiffres au total, hors de la fenêtre
    expect(repairTruncatedFrenchMobile('+61412345678')).toBe('+61412345678');
  });

  it('ne touche pas à un vrai numéro russe', () => {
    expect(repairTruncatedFrenchMobile('+79161234567')).toBe('+79161234567');
  });

  it('ne touche pas à un numéro français déjà correct', () => {
    expect(repairTruncatedFrenchMobile('+33637911292')).toBe('+33637911292');
  });

  it('ne touche pas aux indicatifs autres que 6 et 7', () => {
    expect(repairTruncatedFrenchMobile('+441234567')).toBe('+441234567');
  });

  it('est idempotent', () => {
    const une = repairTruncatedFrenchMobile('+637911292');
    expect(repairTruncatedFrenchMobile(une)).toBe(une);
  });
});

describe('normalizePhone', () => {
  it('enlève espaces, points et tirets', () => {
    expect(normalizePhone('06 37 91 12 92')).toBe('0637911292');
    expect(normalizePhone('06.37.91.12.92')).toBe('0637911292');
    expect(normalizePhone('06-37-91-12-92')).toBe('0637911292');
  });

  it('répare un mobile amputé', () => {
    expect(normalizePhone('+6 37 91 12 92')).toBe('+33637911292');
  });

  it('NE convertit PAS le format 0X en +33', () => {
    // 4 554 fiches sont stockées en 0X et les recherches comparent la chaîne
    // telle quelle : convertir créerait un doublon à chaque retour client.
    expect(normalizePhone('0637911292')).toBe('0637911292');
  });

  it('laisse passer les valeurs vides sans planter', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe(null);
    expect(normalizePhone(undefined)).toBe(undefined);
  });
});

describe('isFrenchMobile', () => {
  it('accepte les mobiles français dans tous les formats', () => {
    expect(isFrenchMobile('0637911292')).toBe(true);
    expect(isFrenchMobile('+33637911292')).toBe(true);
    expect(isFrenchMobile('+637911292')).toBe(true); // amputé, réparé
    expect(isFrenchMobile('07 87 87 63 77')).toBe(true);
  });

  it('REFUSE les fixes français — un SMS ne peut pas y arriver', () => {
    // C'est l'erreur Twilio 21635 qui a produit 141 échecs en boucle
    // du 20 au 25 juillet 2026.
    expect(isFrenchMobile('0476180919')).toBe(false);
    expect(isFrenchMobile('+33476180919')).toBe(false);
    expect(isFrenchMobile('0156789012')).toBe(false);
  });

  it('refuse les numéros étrangers', () => {
    expect(isFrenchMobile('+41791234567')).toBe(false);
    expect(isFrenchMobile('+61412345678')).toBe(false);
  });

  it('refuse les valeurs vides', () => {
    expect(isFrenchMobile('')).toBe(false);
    expect(isFrenchMobile(null)).toBe(false);
  });
});

describe('isFrenchPhone', () => {
  it('accepte fixes ET mobiles — la distinction se fait ailleurs', () => {
    expect(isFrenchPhone('0476180919')).toBe(true);
    expect(isFrenchPhone('0637911292')).toBe(true);
  });
});

describe('formatPhoneInternational', () => {
  it('passe un 0X en +33', () => {
    expect(formatPhoneInternational('0637911292')).toBe('+33637911292');
  });

  it('répare un mobile amputé', () => {
    expect(formatPhoneInternational('+637911292')).toBe('+33637911292');
  });

  it('laisse un numéro étranger intact', () => {
    expect(formatPhoneInternational('+41791234567')).toBe('+41791234567');
  });
});

describe('middleware normalizePhoneFields', () => {
  const passer = (body) => {
    const req = { body };
    let appele = false;
    normalizePhoneFields(req, {}, () => { appele = true; });
    expect(appele).toBe(true);
    return req.body;
  };

  it('répare le champ phone', () => {
    expect(passer({ phone: '+637911292' }).phone).toBe('+33637911292');
  });

  it('répare le champ client_phone du tunnel de réservation', () => {
    expect(passer({ client_phone: '+787876377' }).client_phone).toBe('+33787876377');
  });

  it('ne touche pas aux autres champs', () => {
    const body = passer({ phone: '+637911292', first_name: 'Nino', email: 'a@b.fr' });
    expect(body.first_name).toBe('Nino');
    expect(body.email).toBe('a@b.fr');
  });

  it('supporte un corps vide ou absent', () => {
    expect(() => passer({})).not.toThrow();
    const req = { body: undefined };
    let appele = false;
    normalizePhoneFields(req, {}, () => { appele = true; });
    expect(appele).toBe(true);
  });

  it('ignore un phone qui n’est pas une chaîne', () => {
    expect(passer({ phone: 12345 }).phone).toBe(12345);
  });
});
