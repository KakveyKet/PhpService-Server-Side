export function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

export function errorHandler(error, _req, res, _next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal server error';

  if (error.name === 'ValidationError') {
    statusCode = 422;
    message = Object.values(error.errors).map((item) => item.message).join(', ');
  }

  if (error.code === 11000) {
    statusCode = 409;
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'value';
    message = `${field} already exists`;
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: error.details || undefined,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
}
