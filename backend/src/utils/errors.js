/**
 * Custom API error class for consistent error handling
 */
class ApiError extends Error {
  // code : identifiant stable que le front peut tester (ex. 'booking_closed'),
  // là où le message, lui, est fait pour être lu et peut changer.
  constructor(statusCode, message, details = null, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    this.name = 'ApiError';
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Non autorisé') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Accès interdit') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Ressource introuvable') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflit — ce créneau vient d\'être pris') {
    return new ApiError(409, message);
  }

  static tooMany(message = 'Trop de tentatives, réessayez dans quelques minutes') {
    return new ApiError(429, message);
  }

  static internal(message = 'Erreur serveur, réessayez dans quelques instants') {
    return new ApiError(500, message);
  }
}

module.exports = { ApiError };
