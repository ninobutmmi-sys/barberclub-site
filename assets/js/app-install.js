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
    if (!blocs.length) return;

    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS 13+ se fait passer pour un Mac : le tactile le trahit
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/.test(ua);

    Array.prototype.forEach.call(blocs, function (bloc) {
        var ios = bloc.querySelector('.app-store-ios');
        var android = bloc.querySelector('.app-store-android');
        if (!ios || !android) return;

        if (isIOS) {
            android.classList.add('app-store-secondary');
        } else if (isAndroid) {
            bloc.querySelector('.app-stores').insertBefore(android, ios);
            ios.classList.add('app-store-secondary');
        }
        bloc.classList.add('is-ready');
    });
})();
