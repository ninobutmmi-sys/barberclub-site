// Booking modal functionality
function initBookingModal(targetReservationUrl) {
    const modal = document.getElementById('bookingModal');
    const modalConfirm = document.getElementById('modalConfirm');
    if (!modal || !modalConfirm) return;
    const bookingButtons = document.querySelectorAll('a[href*="reserver-"]');
    
    // Intercept booking button clicks
    bookingButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });

    // Confirm button
    modalConfirm.addEventListener('click', () => {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        window.location.href = targetReservationUrl;
    });

    // Close on overlay click
    modal.querySelector('.modal-overlay').addEventListener('click', () => {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
}
