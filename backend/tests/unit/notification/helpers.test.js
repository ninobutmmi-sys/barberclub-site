jest.mock('../../../src/config/env', () => require('../helpers/mockEnv'));

const { formatPhoneInternational, isFrenchPhone } = require('../../../src/services/notification/helpers');

describe('formatPhoneInternational', () => {
  test('normalise un mobile français 0X en +33', () => {
    expect(formatPhoneInternational('0619084840')).toBe('+33619084840');
    expect(formatPhoneInternational('06 19 08 48 40')).toBe('+33619084840');
  });

  test('laisse intact un numéro déjà en +33', () => {
    expect(formatPhoneInternational('+33619084840')).toBe('+33619084840');
  });

  // Régression : l'import Timify a amputé le 0 initial (`+6XXXXXXXX`), ce qui sort de
  // la plage France en E.164 — Brevo et Twilio rejetaient l'envoi en silence.
  test('rattrape les mobiles français amputés du 0 (+6/+7 sur 9 chiffres)', () => {
    expect(formatPhoneInternational('+619084840')).toBe('+33619084840');
    expect(formatPhoneInternational('+781258255')).toBe('+33781258255');
    expect(formatPhoneInternational('+660390847')).toBe('+33660390847');
  });

  test('rattrape aussi la forme sans le +', () => {
    expect(formatPhoneInternational('619084840')).toBe('+33619084840');
  });

  test('ne touche pas aux vrais numéros étrangers en +6/+7 (10 chiffres et plus)', () => {
    expect(formatPhoneInternational('+61412345678')).toBe('+61412345678'); // Australie
    expect(formatPhoneInternational('+79161234567')).toBe('+79161234567'); // Russie
    expect(formatPhoneInternational('+6598765432')).toBe('+6598765432');   // Singapour
  });

  test('ne touche pas aux autres indicatifs', () => {
    expect(formatPhoneInternational('+393389709957')).toBe('+393389709957');
    expect(formatPhoneInternational('+447825544334')).toBe('+447825544334');
  });
});

describe('isFrenchPhone', () => {
  test('reconnaît les formats français classiques', () => {
    expect(isFrenchPhone('0619084840')).toBe(true);
    expect(isFrenchPhone('+33619084840')).toBe(true);
  });

  // Sans ce rattrapage, le rappel SMS était remplacé par un email pour ces clients.
  test('reconnaît un mobile français amputé du 0', () => {
    expect(isFrenchPhone('+619084840')).toBe(true);
    expect(isFrenchPhone('+781258255')).toBe(true);
  });

  test('rejette les numéros réellement étrangers', () => {
    expect(isFrenchPhone('+61412345678')).toBe(false);
    expect(isFrenchPhone('+393389709957')).toBe(false);
  });

  test('gère les valeurs vides', () => {
    expect(isFrenchPhone('')).toBe(false);
    expect(isFrenchPhone(null)).toBe(false);
  });
});
