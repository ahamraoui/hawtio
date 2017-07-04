const gulp          = require('gulp'),
    eventStream     = require('event-stream'),
    gulpLoadPlugins = require('gulp-load-plugins'),
    map             = require('vinyl-map'),
    fs              = require('fs'),
    path            = require('path'),
    sequence        = require('run-sequence'),
    size            = require('gulp-size'),
    uri             = require('urijs'),
    s               = require('underscore.string'),
    argv            = require('yargs').argv,
    logger          = require('js-logger'),
    hawtio          = require('@hawtio/node-backend'),
    tslint          = require('gulp-tslint'),
    tslintRules     = require('./tslint.json'),
    yarn            = require('gulp-yarn');

const plugins = gulpLoadPlugins({});

const config = {
  proxyPort      : argv.port || 8181,
  targetPath     : argv.path || '/hawtio/jolokia',
  logLevel       : argv.debug ? logger.DEBUG : logger.INFO,
  src            : 'src/',
  srcTs          : 'src/**/*.ts',
  srcLess        : 'src/**/*.less',
  srcTemplates   : 'src/**/!(index).html',
  templateModule : 'hawtio-console-assembly-templates',
  temp           : 'temp/',
  dist           : 'dist/',
  distJs         : 'dist/js',
  distCss        : 'dist/css',
  distFonts      : 'dist/fonts',
  distLibs       : 'dist/libs',
  distImg        : 'dist/img',
  js             : 'hawtio-console-assembly.js',
  css            : 'hawtio-console-assembly.css',
  tsProject      : plugins.typescript.createProject('tsconfig.json'),
  tsLintOptions  : {
    rulesDirectory: './tslint-rules/'
  },
  sourceMap: argv.sourcemap
};

var normalSizeOptions = {
    showFiles: true
}, gZippedSizeOptions  = {
    showFiles: true,
    gzip: true
};

//------------------------------------------------------------------------------
// build tasks
//------------------------------------------------------------------------------

gulp.task('clean', function() {
  return gulp.src(['dist', 'temp'], { read: false })
    .pipe(plugins.clean());
});

gulp.task('tsc', function() {
  return gulp.src(config.srcTs)
    .pipe(plugins.debug({ title: 'tsc' }))
    .pipe(plugins.if(config.sourceMap, plugins.sourcemaps.init()))
    .pipe(config.tsProject())
    .on('error', plugins.notify.onError({
      message: '<%= error.message %>',
      title: 'Typescript compilation error'
    }))
    .js
    .pipe(plugins.debug({ title: 'tsc js' }))
    .pipe(plugins.if(config.sourceMap, plugins.sourcemaps.write()))
    .pipe(gulp.dest(config.temp));
});

gulp.task('template', function() {
  return gulp.src(config.srcTemplates)
    .pipe(plugins.angularTemplatecache({
      filename: 'templates.js',
      root: config.src,
      standalone: true,
      module: config.templateModule,
      templateFooter: '}]); hawtioPluginLoader.addModule("' + config.templateModule + '");'
    }))
    .pipe(gulp.dest(config.temp));
});

gulp.task('concat', function() {
  var gZipSize = size(gZippedSizeOptions);
  var license = tslintRules.rules['license-header'][1];
  return gulp.src(config.temp + '*.js')
    .pipe(plugins.concat(config.js))
    .pipe(plugins.header(license))
    .pipe(size(normalSizeOptions))
    .pipe(gZipSize)
    .pipe(gulp.dest(config.distJs));
});

gulp.task('less', function() {
  return gulp.src(config.srcLess)
    .pipe(plugins.less())
    .pipe(plugins.concat(config.css))
    .pipe(gulp.dest(config.distCss));
});

gulp.task('usemin', function() {
  return gulp.src(config.src + 'index.html')
    .pipe(plugins.usemin({
      css: [plugins.minifyCss({ keepBreaks: true }), 'concat'],
      js: [
        plugins.sourcemaps.init({
          loadMaps: true
        }),
        'concat',
        plugins.uglify(),
        plugins.rev(),
        plugins.sourcemaps.write('./')
      ]
    }))
    .pipe(plugins.debug({ title: 'usemin' }))
    .pipe(gulp.dest(config.dist));
});

// gulp.task('tweak-urls', ['usemin'], () =>
//   eventStream.merge(
//     gulp.src('target/site/index.html')
//       // adjust image paths
//       .pipe(plugins.replace(/"node_modules\/[^/]+\/img\//gm, '"img/')),
//     gulp.src('target/site/style.css')
//       .pipe(plugins.replace(/url\(\.\.\//g, 'url('))
//       // tweak fonts URL coming from PatternFly that does not repackage then in dist
//       .pipe(plugins.replace(/url\(\.\.\/components\/font-awesome\//g, 'url('))
//       .pipe(plugins.replace(/url\(\.\.\/components\/bootstrap\/dist\//g, 'url('))
//       .pipe(plugins.replace(/url\(node_modules\/bootstrap\/dist\//g, 'url('))
//       .pipe(plugins.replace(/url\(node_modules\/patternfly\/components\/bootstrap\/dist\//g, 'url('))
//       .pipe(plugins.debug({ title: 'tweak-urls' }))
//     )
//     .pipe(gulp.dest('target/site')
//   )
// );

gulp.task('install-dependencies', function() {
  return gulp.src(['package.json', 'yarn.lock'])
    .pipe(gulp.dest(config.temp))
    .pipe(yarn({
      production: true,
      flat: true,
      noBinLinks: true,
      noProgress: true,
      ignoreScripts: true,
      nonInteractive: true
    }));
});

gulp.task('copy-dependencies', function() {
  return gulp.src([config.temp + 'node_modules/**/*'])
    .pipe(gulp.dest(config.distLibs));
});

gulp.task('copy-images', function() {
  var hawtioDependencies = config.temp + 'node_modules/@hawtio';
  var dirs = fs.readdirSync(hawtioDependencies);
  var patterns = [];
  dirs.forEach(function(dir) {
    var path = hawtioDependencies + '/' + dir + '/dist/img';
    try {
      if (fs.statSync(path).isDirectory()) {
        console.log('found image dir: ', path);
        var pattern = hawtioDependencies + '/' + dir + '/dist/img/**/*';
        patterns.push(pattern);
      }
    } catch (e) {
      // ignore, file does not exist
    }
  });
  // Add PatternFly images package in dist
  patterns.push(config.temp + 'node_modules/patternfly/dist/img/**/*');
  return gulp.src(patterns)
    .pipe(plugins.debug({ title: 'image copy' }))
    .pipe(gulp.dest(config.distImg));
});

gulp.task('404', ['usemin'], function() {
  return gulp.src(config.dist + 'index.html')
    .pipe(plugins.rename('404.html'))
    .pipe(gulp.dest(config.dist));
});

//------------------------------------------------------------------------------
// serve tasks
//------------------------------------------------------------------------------

gulp.task('connect', function() {
  hawtio.setConfig({
    logLevel: config.logLevel,
    port: 2772,
    staticProxies: [
    {
      proto: 'http',
      port: config.proxyPort,
      hostname: 'localhost',
      path: '/hawtio/jolokia',
      targetPath: config.targetPath
    }
    ],
    staticAssets: [{
      path: '/hawtio/',
      dir: './dist/'

    }],
    liveReload: {
      enabled: true
    }
  });

  hawtio.use('/', (req, res, next) => {
    if (!s.startsWith(req.originalUrl, '/hawtio/')) {
      res.redirect('/hawtio/');
    } else {
      next();
    }
  });

  hawtio.listen(function(server) {
    var host = server.address().address;
    var port = server.address().port;
    console.log("started from gulp file at ", host, ":", port);
  });
});

gulp.task('watch', function() {
  gulp.watch([
    config.distCss + '*',
    config.distJs + '*',
    config.dist + 'index.html'
  ], ['reload']);
  gulp.watch([config.srcTs, config.srcTemplates], ['tsc', 'template', 'concat']);
  gulp.watch(config.srcLess, ['less']);
  gulp.watch(config.src + 'index.html', ['usemin']);
});

gulp.task('reload', function() {
  gulp.src('dist/index.html')
    .pipe(hawtio.reload());
});

//------------------------------------------------------------------------------
// main tasks
//------------------------------------------------------------------------------

gulp.task('build', callback => sequence('clean', 'tsc', 'template', 'concat', 'less', 'usemin', 'install-dependencies',
  'copy-dependencies', 'copy-images', '404', callback));

gulp.task('default', callback => sequence('build', ['connect', 'watch']));
