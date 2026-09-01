/**
 * BarberClub — Le bloc « installer l'application » des pages Mon compte
 *
 * Un iPhone n'a rien a faire d'un lien Google Play. Le bouton principal est
 * celui du magasin du telephone ; l'autre reste accessible en dessous, en
 * petit, parce qu'on consulte parfois la page depuis un ordinateur pour
 * l'installer ensuite ailleurs.
 *
 * Sur ordinateur, les deux magasins s'affichent a egalite.
 */
(function () {
    'use strict';

    var blocs = document.querySelectorAll('.app-install');
    // Tout groupe de boutons de magasin est concerne, y compris celui de la
    // carte de fidelite qui vit en dehors d'un bloc .app-install.
    var groupes = document.querySelectorAll('.app-stores');
    if (!blocs.length && !groupes.length) return;

    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS 13+ se fait passer pour un Mac : le tactile le trahit
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/.test(ua);

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    Array.prototype.forEach.call(blocs, function (bloc) {
        // Les nappes de couleur sont des elements a part : en pseudo-elements
        // il n'y en aurait qu'un seul par bloc, et il en faut deux qui derivent
        // chacune a son rythme.
        if (!bloc.querySelector('.app-aurora')) {
            var aurora = document.createElement('div');
            aurora.className = 'app-aurora';
            aurora.setAttribute('aria-hidden', 'true');
            aurora.innerHTML = '<span></span><span></span>';
            bloc.insertBefore(aurora, bloc.firstChild);
        }

        // L'icone recoit son halo : il lui faut un parent a lui.
        var icon = bloc.querySelector('.app-install-icon');
        if (icon && !icon.parentNode.classList.contains('app-install-icon-wrap')) {
            var wrap = document.createElement('div');
            wrap.className = 'app-install-icon-wrap';
            icon.parentNode.insertBefore(wrap, icon);
            wrap.appendChild(icon);
        }

        // Le bloc se leve quand il entre dans l'ecran, pas au chargement : il
        // est sous la ligne de flottaison, l'animation serait passee sans temoin.
        if (reduceMotion || !('IntersectionObserver' in window)) {
            bloc.classList.add('is-seen');
        } else {
            var obs = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    if (e.isIntersecting) {
                        e.target.classList.add('is-seen');
                        obs.unobserve(e.target);
                    }
                });
            }, { threshold: 0.25 });
            obs.observe(bloc);
        }
    });

    Array.prototype.forEach.call(groupes, function (groupe) {
        var ios = groupe.querySelector('.app-store-ios');
        var android = groupe.querySelector('.app-store-android');
        if (!ios || !android) return;

        if (isIOS) {
            android.classList.add('app-store-secondary');
        } else if (isAndroid) {
            groupe.insertBefore(android, ios);
            ios.classList.add('app-store-secondary');
        }
        groupe.classList.add('is-ready');
    });
})();
