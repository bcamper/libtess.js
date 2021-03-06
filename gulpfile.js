/* jshint node: true */

var gulp = require('gulp');
var replace = require('gulp-replace');
var concat = require('gulp-concat');
var closureCompiler = require('gulp-closure-compiler');
var mocha = require('gulp-mocha');
var browserify = require('browserify');
var envify = require('envify/custom');
var glob = require('glob');
var vinylSource = require('vinyl-source-stream');
var jshint = require('gulp-jshint');
var stylish = require('jshint-stylish');
var jscs = require('gulp-jscs');
var filter = require('gulp-filter');
var istanbul = require('gulp-istanbul');
var exec = require('child_process').exec;

var COMPILER_PATH = 'node_modules/closurecompiler/compiler/compiler.jar';
var LIBTESS_SRC = ['./src/libtess.js', './src/**/*.js'];
// NOTE(bckenny): checking all of third_party for now. Modify if checking in
// third-party code that doesn't conform to style.
var LINT_SRC = LIBTESS_SRC.concat([
  './gulpfile.js',
  './libtess.cat.js',
  './{build,examples,test,third_party}/**/*.{js,html}',
  '!./build/externs/*',
  '!./test/browser/*-browserified.js',
  '!./test/expectations/*',
  '!./third_party/node_modules/**'
]);

gulp.task('build-cat', function() {
  return gulp.src(LIBTESS_SRC.concat('./build/node_export.js'))
    // remove license at top of each file
    .pipe(replace(/^\/\*[\s\*]+Copyright 2000[\s\S]*?\*\//m, ''))
    .pipe(concat('libtess.cat.js'))
    .pipe(gulp.dest('.'));
});

gulp.task('build-min', function() {
  return gulp.src(LIBTESS_SRC.concat('./build/closure_exports.js'))
    .pipe(closureCompiler({
      compilerPath: COMPILER_PATH,
      fileName: 'libtess.min.js',
      compilerFlags: {
        compilation_level: 'ADVANCED_OPTIMIZATIONS',
        warning_level: 'VERBOSE',
        language_in: 'ECMASCRIPT5_STRICT',
        define: [
          // NOTE(bckenny): switch to true for assertions throughout code
          'libtess.DEBUG=false'
        ],
        jscomp_warning: [
          // https://github.com/google/closure-compiler/wiki/Warnings
          'accessControls',
          'const',
          'visibility',
        ],
        use_types_for_optimization: null,
        use_only_custom_externs: null,
        externs: [
          './build/externs/es5.js',
          './build/externs/es3.js'
        ],

        // for node export
        output_wrapper: '%output% if (typeof module !== \'undefined\') { ' +
            'module.exports = this.libtess; }'
      }
    }))
    .pipe(gulp.dest('.'));
});

// copy latest mocha and chai over to third_party for distribution for live
// testing on gh-pages
gulp.task('dist-test-libs', function() {
  return gulp.src([
    'node_modules/mocha/mocha.{css,js}',
    'node_modules/mocha/LICENSE',
    'node_modules/chai/{chai.js,README.md}',
  ], {base: './'})
    .pipe(gulp.dest('./third_party'));
});

gulp.task('browserify-tests', function() {
  // only includes baseline tess (uses libtess in page), so no prereqs
  return browserify(glob.sync('./test/*.test.js'))
    // custom chai and libtess injected on page (for e.g. debug libtess)
    // TODO(bckenny): is there a less-dumb way of doing this?
    .require('./test/browser/fake-chai.js', {expose: 'chai'})
    .require('./test/browser/fake-libtess.js',
        {expose: '../libtess.cat.js'})
    .require('./test/browser/fake-libtess.js',
        {expose: '../libtess.min.js'})

    // expand list of tests in geometry/ at browserify time
    .ignore('./test/rfolder.js')
    .transform('rfolderify')

    // eliminate env nonsense in common.js
    .transform(envify({
      testType: 'browserify'
    }))

    .bundle()

    // convert to vinyl stream and output via gulp.dest
    .pipe(vinylSource('tests-browserified.js'))
    .pipe(gulp.dest('./test/browser'));
});

// TODO(bckenny): more incremental
gulp.task('build', [
  'build-cat',
  'build-min',
  'browserify-tests',
  'dist-test-libs',
  'browserify-expectations-viewer'
]);

gulp.task('lint', ['build'], function() {
  return gulp.src(LINT_SRC)
    // jshint
    .pipe(jshint.extract('auto'))
    .pipe(jshint())
    .pipe(jshint.reporter(stylish))
    .pipe(jshint.reporter('fail'))

    // jscs (code style)
    // TODO(bckenny): get jscs to lint inline JS in html?
    .pipe(filter('**/*.js'))
    .pipe(jscs());
});

gulp.task('test', ['lint'], function() {
  return gulp.src('test/*.test.js', {read: false})
    .pipe(mocha({
      reporter: 'spec',
      ui: 'tdd'
    }));
});

// TODO(bckenny): clean this up
gulp.task('coverage', ['build'], function(doneCallback) {
  // use libtess.cat.js for coverage testing (see TODO in test/common.js)
  process.env.testType = 'coverage';

  gulp.src('libtess.cat.js')
    .pipe(istanbul())
    .on('finish', function() {
      gulp.src('test/*.test.js')
        .pipe(mocha({
          reporter: 'dot',
          ui: 'tdd'
        }))

        .pipe(istanbul.writeReports())
        .on('end', function() {
          // send coverage information to coveralls.io if running on travis
          if (process.env.TRAVIS) {
            exec('./node_modules/coveralls/bin/coveralls.js < ' +
                './coverage/lcov.info',
                function(error, stdout, stderr) {
                  console.log('stdout: ' + stdout);
                  console.log('stderr: ' + stderr);
                  doneCallback(error);
                });
          } else {
            console.log('exiting coverage without uploading to coveralls');
            doneCallback();
          }
        });
    });
});

gulp.task('browserify-expectations-viewer', function() {
  return browserify('./test/expectations-viewer.js')
    .require('./test/browser/fake-chai.js', {expose: 'chai'})
    .require('./test/browser/fake-libtess.js',
        {expose: '../libtess.cat.js'})
    .require('./test/browser/fake-libtess.js',
        {expose: '../libtess.min.js'})

    // expand list of tests in geometry/ at browserify time
    .ignore('./test/rfolder.js')
    .transform('rfolderify')

    // eliminate env nonsense in common.js
    .transform(envify({
      testType: 'browserify'
    }))

    .bundle()

    // convert to vinyl stream and output via gulp.dest
    .pipe(vinylSource('expectations-viewer-browserified.js'))
    .pipe(gulp.dest('./test/browser'));
});

gulp.task('default', ['build']);
