/* ═══════════════════════════════════════════
   BarberClub — Le halo de la barre de navigation

   Le halo est une lumiere posee derriere l'onglet courant. Quand on en touche
   un autre, il y glisse — et comme la page met 700 ms a basculer, le
   mouvement a le temps de se terminer sous les yeux : on arrive sur la page
   suivante avec la lumiere deja en place. La navigation parait continue au
   lieu de sauter d'un ecran a l'autre.

   Chargee par les 12 pages de salon, apres bottom-nav.css.
   ═══════════════════════════════════════════ */
(function () {
    'use strict';

    var nav = document.querySelector('.bottom-nav');
    if (!nav) return;

    var row = nav.querySelector('.nav-row');
    var items = Array.prototype.slice.call(nav.querySelectorAll('.nav-item'));
    if (!row || !items.length) return;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var glow = document.createElement('span');
    glow.className = 'nav-glow';
    glow.setAttribute('aria-hidden', 'true');
    row.insertBefore(glow, row.firstChild);

    var current = items.find(function (i) { return i.classList.contains('active'); }) || null;

    function place(target, animate) {
        if (!target) {
            glow.style.opacity = '0';
            return;
        }
        var r = target.getBoundingClientRect();
        var base = row.getBoundingClientRect();
        glow.style.transition = animate ? '' : 'none';
        glow.style.width = r.width + 'px';
        glow.style.height = r.height + 'px';
        glow.style.transform = 'translate3d(' + (r.left - base.left) + 'px, ' + (r.top - base.top) + 'px, 0)';
        glow.style.opacity = '1';
        if (!animate) {
            // On force le calcul avant de rendre la transition, sinon le halo
            // traverse la barre au chargement.
            void glow.offsetWidth;
            glow.style.transition = '';
        }
    }

    // Position de depart, sans mouvement.
    place(current, false);
    requestAnimationFrame(function () { nav.classList.add('nav-ready'); });

    if (reduceMotion) return;

    items.forEach(function (item) {
        item.addEventListener('pointerdown', function (e) {
            place(item, true);
            ripple(item, e);
        });
    });

    var cta = nav.querySelector('.nav-cta');
    if (cta) {
        cta.addEventListener('pointerdown', function () {
            // Le bouton central a sa propre lumiere : le halo s'efface pour
            // ne pas se battre avec elle.
            glow.style.opacity = '0';
        });
    }

    /* Une onde part du point touche. */
    function ripple(item, e) {
        var r = item.getBoundingClientRect();
        var dot = document.createElement('span');
        dot.className = 'nav-ripple';
        var x = (e && e.clientX ? e.clientX : r.left + r.width / 2) - r.left;
        var y = (e && e.clientY ? e.clientY : r.top + r.height / 2) - r.top;
        dot.style.left = x + 'px';
        dot.style.top = y + 'px';
        item.appendChild(dot);
        setTimeout(function () { dot.remove(); }, 620);
    }

    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { place(current, false); }, 120);
    }, { passive: true });

    // Retour depuis le cache du navigateur : la barre reprend son etat.
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) place(current, false);
    });
})();
