const success = (res, statusCode, data, message = 'Success') => {
  return res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
};

const error = (res, statusCode, message = 'An error occurred') => {
  return res.status(statusCode).json({
    status: 'fail',
    message,
  });
};

module.exports = { success, error };
