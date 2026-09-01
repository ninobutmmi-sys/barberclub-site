/* ═══════════════════════════════════════════
   BarberClub — Animation des cartes de l'equipe
   pages/meylan/barbers.html & pages/grenoble/barbers.html

   Les cartes s'animaient toutes au chargement, avec un delai fixe par
   position. Sur un telephone, celles du bas avaient fini de jouer bien avant
   qu'on arrive dessus : on scrollait vers des cartes deja posees.

   Elles arrivent maintenant en cascade, une par une, et celles du bas
   attendent d'entrer dans l'ecran. Une fois visible, la photo derive
   lentement — et s'arrete des que la carte sort de l'ecran. Le mouvement
   reduit court-circuite tout : les cartes sont posees d'entree.
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

    // Cascade a l'arrivee : chaque carte part 110 ms apres la precedente. Sur
    // un telephone ou les quatre cartes tiennent dans la fenetre, elles
    // etaient toutes posees avant meme que la page s'affiche — on ne voyait
    // rien bouger.
    cards.forEach(function (card, i) {
        card.style.setProperty('--enter-delay', (i * 110) + 'ms');
    });

    var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            var card = entry.target;
            if (entry.isIntersecting) {
                card.classList.add('in-view');
                // La derive lente de la photo ne tourne que sur les cartes
                // visibles : inutile de faire travailler le telephone pour
                // une image qui n'est pas a l'ecran.
                card.classList.add('is-live');
            } else {
                card.classList.remove('is-live');
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -30px 0px' });

    cards.forEach(function (c) { obs.observe(c); });
})();
