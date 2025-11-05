const {
    sanitize,
    sanitizeOptions,
    getUrlStringfromUrlObject,
    addFormParam,
    form,
    shouldAddHttpMethod
  } = require('./util'),
  _ = require('./lodash');

var self;

self = module.exports = {
  convert: function (request, options, callback) {

    if (!_.isFunction(callback)) {
      throw new Error('Postman-CLI-Converter: callback is not valid function');
    }
    options = sanitizeOptions(options, self.getOptions());

    var indent, trim, headersData, body, redirect, timeout, multiLine,
      format, snippet, quiet, url, quoteType, maxRedirects, followOriginalHttpMethod;

    redirect = options.followRedirect;
    maxRedirects = options.maxRedirects;
    timeout = options.requestTimeoutInSeconds;
    multiLine = options.multiLine;
    format = options.longFormat;
    trim = options.trimRequestBody;
    quiet = options.quiet;
    followOriginalHttpMethod = options.followOriginalHttpMethod;
    quoteType = options.quoteType === 'single' ? '\'' : '"';
    url = getUrlStringfromUrlObject(request.url, quoteType);

    snippet = 'postman request';

    if (shouldAddHttpMethod(request, options)) {
      snippet += ` ${request.method}`;
    }

    if (multiLine) {
      indent = options.indentType === 'Tab' ? '\t' : ' ';
      indent = ' ' + options.lineContinuationCharacter + '\n' + indent.repeat(options.indentCount); // eslint-disable-line max-len
    }
    else {
      indent = ' ';
    }

    snippet += ` ${quoteType + url + quoteType}`;

    if (quiet) {
      snippet += `${indent}${form('-q', format)}`;
    }
    if (timeout > 0) {
      snippet += `${indent}--timeout ${timeout}`;
    }

    if (request.body && !request.headers.has('Content-Type')) {
      if (request.body.mode === 'file') {
        request.addHeader({
          key: 'Content-Type',
          value: 'text/plain'
        });
      }
      else if (request.body.mode === 'graphql') {
        request.addHeader({
          key: 'Content-Type',
          value: 'application/json'
        });
      }
    }
    headersData = request.toJSON().header;
    if (headersData) {
      headersData = _.reject(headersData, 'disabled');
      _.forEach(headersData, (header) => {
        if (!header.key) {
          return;
        }
        snippet += indent + `${form('-H', format)} ${quoteType}${sanitize(header.key, true, quoteType)}`;
        snippet += `: ${sanitize(header.value, false, quoteType)}${quoteType}`;
      });
    }

    // The following code handles multiple files in the same formdata param.
    // It removes the form data params where the src property is an array of filepath strings
    // Splits that array into different form data params with src set as a single filepath string
    if (request.body && request.body.mode === 'formdata') {
      let formdata = request.body.formdata,
        formdataArray = [];
      formdata.members.forEach((param) => {
        let key = param.key,
          type = param.type,
          disabled = param.disabled,
          contentType = param.contentType;
        if (type === 'file') {
          if (typeof param.src !== 'string') {
            if (Array.isArray(param.src) && param.src.length) {
              param.src.forEach((filePath) => {
                addFormParam(formdataArray, key, param.type, filePath, disabled, contentType);
              });
            }
            else {
              addFormParam(formdataArray, key, param.type, '/path/to/file', disabled, contentType);
            }
          }
          else {
            addFormParam(formdataArray, key, param.type, param.src, disabled, contentType);
          }
        }
        else {
          addFormParam(formdataArray, key, param.type, param.value, disabled, contentType);
        }
      });
      request.body.update({
        mode: 'formdata',
        formdata: formdataArray
      });
    }
    if (request.body) {
      body = request.body.toJSON();

      if (!_.isEmpty(body)) {
        switch (body.mode) {
          case 'urlencoded':
            _.forEach(body.urlencoded, function (data) {
              if (!data.disabled) {
                snippet += indent + (format ? '--data-urlencode' : '-d');
                snippet += ` ${quoteType}${sanitize(data.key, trim, quoteType, false, true)}=` +
                  `${sanitize(data.value, trim, quoteType, false, !format)}${quoteType}`;
              }
            });
            break;
          case 'raw': {
            let rawBody = body.raw.toString(),
              sanitizedBody = sanitize(rawBody, trim, quoteType);

            if (!multiLine) {
              try {
                sanitizedBody = JSON.stringify(JSON.parse(sanitizedBody));
              }
              catch (e) {
                // Do nothing
              }
            }

            snippet += indent + `${form('-d', format)} ${quoteType}${sanitizedBody}${quoteType}`;

            break;
          }

          case 'formdata':
            _.forEach(body.formdata, function (data) {
              if (!(data.disabled)) {
                if (data.type === 'file') {
                  snippet += ` ${quoteType}${sanitize(data.key, trim, quoteType)}=` +
                    `${sanitize(`@"${sanitize(data.src, trim, '"', true)}"`, trim, quoteType, quoteType === '"')}`;
                  snippet += quoteType;
                }
                else {
                  snippet += ` ${quoteType}${sanitize(data.key, trim, quoteType)}=` +
                    sanitize(`"${sanitize(data.value, trim, '"', true)}"`, trim, quoteType, quoteType === '"');
                  if (data.contentType) {
                    snippet += `;type=${data.contentType}`;
                  }
                  snippet += quoteType;
                }
              }
            });
            break;
          case 'file':
            snippet += indent + form('-d', format) + ` ${quoteType}@${sanitize(body[body.mode].src, trim)}${quoteType}`;
            break;
          default:
            snippet += `${form('-d', format)} ${quoteType}${quoteType}`;
        }
      }
    }

    if (!redirect) {
      snippet += `${indent}--redirects-ignore`;
    }

    if (followOriginalHttpMethod) {
      snippet += `${indent}--redirect-follow-method`;
    }

    if (maxRedirects > 0) {
      snippet += `${indent}--max-redirects ${maxRedirects}`;
    }

    callback(null, snippet);
  },
  getOptions: function () {
    return [
      {
        name: 'Generate multiline snippet',
        id: 'multiLine',
        type: 'boolean',
        default: true,
        description: 'Split cURL command across multiple lines'
      },
      {
        name: 'Use long form options',
        id: 'longFormat',
        type: 'boolean',
        default: true,
        description: 'Use the long form for cURL options (--header instead of -H)'
      },
      {
        name: 'Line continuation character',
        id: 'lineContinuationCharacter',
        availableOptions: ['\\', '^', '`'],
        type: 'enum',
        default: '\\',
        description: 'Set a character used to mark the continuation of a statement on the next line ' +
          '(generally, \\ for OSX/Linux, ^ for Windows cmd and ` for Powershell)'
      },
      {
        name: 'Quote Type',
        id: 'quoteType',
        availableOptions: ['single', 'double'],
        type: 'enum',
        default: 'single',
        description: 'String denoting the quote type to use (single or double) for URL ' +
          '(Use double quotes when running curl in cmd.exe and single quotes for the rest)'
      },
      {
        name: 'Set request timeout (in seconds)',
        id: 'requestTimeoutInSeconds',
        type: 'positiveInteger',
        default: 0,
        description: 'Set number of seconds the request should wait for a response before ' +
          'timing out (use 0 for infinity)'
      },
      {
        name: 'Follow redirects',
        id: 'followRedirect',
        type: 'boolean',
        default: true,
        description: 'Automatically follow HTTP redirects'
      },
      {
        name: 'Follow original HTTP method',
        id: 'followOriginalHttpMethod',
        type: 'boolean',
        default: false,
        description: 'Redirect with the original HTTP method instead of the default behavior of redirecting with GET'
      },

      {
        name: 'Maximum number of redirects',
        id: 'maxRedirects',
        type: 'positiveInteger',
        default: 0,
        description: 'Set the maximum number of redirects to follow, defaults to 0 (unlimited)'
      },
      {
        name: 'Trim request body fields',
        id: 'trimRequestBody',
        type: 'boolean',
        default: false,
        description: 'Remove white space and additional lines that may affect the server\'s response'
      },
      {
        name: 'Use Quiet Mode',
        id: 'quiet',
        type: 'boolean',
        default: false,
        description: 'Display the requested data without showing any extra output.'
      }
    ];
  }
};
