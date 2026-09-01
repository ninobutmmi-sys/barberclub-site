/* ═══════════════════════════════════════════
   BarberClub — Animation des cartes de l'equipe
   pages/meylan/barbers.html & pages/grenoble/barbers.html

   Les cartes s'animaient toutes au chargement, avec un delai fixe par
   position. Sur un telephone, celles du bas avaient fini de jouer bien avant
   qu'on arrive dessus : on scrollait vers des cartes deja posees.

   Elles se declenchent maintenant quand elles entrent dans l'ecran, une par
   une. Le mouvement reduit court-circuite tout : les cartes sont posees
   d'entree.
   ═══════════════════════════════════════════ */
(function () {
    'use strict';

    var cards = Array.prototype.slice.call(document.querySelectorAll('.barber-card'));
    if (!cards.length) return;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || !('IntersectionObserver' in window)) {
        cards.forEach(function (c) { c.classList.add('in-view'); });
        return;
    }

    document.documentElement.classList.add('cards-observed');

    var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var card = entry.target;
            // Decalage court entre voisines d'une meme rangee : l'oeil suit,
            // sans que la derniere se fasse attendre.
            var row = cards.indexOf(card) % 2;
            card.style.setProperty('--enter-delay', (row * 90) + 'ms');
            card.classList.add('in-view');
            obs.unobserve(card);
        });
    }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });

    cards.forEach(function (c) { obs.observe(c); });
})();
