'use strict';

var setupTests = require('../../_common/setupTests.js');
var backoff = require('backoff');

var testSuite = 'GHC-ORG-PUB-ADM';
var testSuiteDesc = ' - TestSuite for Github Org, public project for Admin';

describe(testSuite + testSuiteDesc,
  function () {
    var projectId = null;
    var runId = null;
    this.timeout(0);

    before(
      function (done) {
        setupTests().then(
          function () {
            global.setupGithubAdminAdapter();
            // get public project before starting the tests
            var query = util.format('name=%s', global.GHC_PUBLIC_PROJ);
            global.ghcAdminAdapter.getProjects(query,
              function (err, projects) {
                if (err || _.isEmpty(projects))
                  return done(new Error(util.format('cannot get project for ' +
                    'query: %s, Err: %s', query, err)));
                var project = _.first(projects);
                projectId = project.id;
                return done();
              }
            );
          },
          function (err) {
            logger.error(testSuite, 'failed to setup tests. err:', err);
            return done(err);
          }
        );
      }
    );

    it('1. Can Enable a public project',
      function (done) {
        var json = {
          type: 'ci'
        };
        global.ghcAdminAdapter.enableProjectById(projectId, json,
          function (err) {
            if (err)
              return done(new Error(util.format('cannot enable public ' +
                'project with id:%s', projectId)));
            global.saveResource(
              {
                type: 'project',
                id: projectId
              },
              function () {
                return done();
              }
            );
          }
        );
      }
    );

    it('2. Can Synchonize a public project',
      function (done) {
        global.ghcAdminAdapter.syncProjectById(projectId,
          function (err, project) {
            assert(!err, util.format('Failed to sync project' +
                '%s with error: %s', projectId, err));
            // NOTE: can add more assertions here
            assert.isNotEmpty(project, 'Project should not be empty');
            assert.isNotEmpty(project.branches, 'Project should have branches');
            return done();
          }
        );
      }
    );

    it('3. Can pause a public project',
      function () {
        var pauseProject = new Promise(
          function (resolve, reject) {
            var json = {propertyBag: {isPaused: true}};
            global.ghcAdminAdapter.putProjectById(projectId, json,
              function (err, project) {
                if (err)
                  return reject(new Error('Cannot pause project'));
                return resolve(project);
              }
            );
          }
        );
        return pauseProject.then(
          function (project) {
            assert.isNotEmpty(project, 'project should not be empty');
            assert.isNotEmpty(project.propertyBag, 'propertyBag should not be'
              + 'empty');
            assert.strictEqual(project.propertyBag.isPaused, true,
              'isPaused should be set to true');
          }
        );
      }
    );

    it('4. Can resume a public project',
      function () {
        var pauseProject = new Promise(
          function (resolve, reject) {
            var json = {propertyBag: {isPaused: false}};
            global.ghcAdminAdapter.putProjectById(projectId, json,
              function (err, project) {
                if (err)
                  return reject(new Error(util.format('Cannot resume project' +
                  'id: %s, err: %s', projectId, err)));
                return resolve(project);
              }
            );
          }
        );
        return pauseProject.then(
          function (project) {
            assert.isNotEmpty(project, 'project should not be empty');
            assert.isNotEmpty(project.propertyBag, 'propertyBag should not be'
              + 'empty');
            assert.strictEqual(project.propertyBag.isPaused, false,
              'isPaused should be set to false');
          }
        );
      }
    );

    it('5. Can trigger manual builds',
      function (done) {
        var triggerBuild = new Promise(
          function (resolve, reject) {
            var json = {branchName: 'master'};
            global.ghcAdminAdapter.triggerNewBuildByProjectId(projectId, json,
              function (err, response) {
                if (err)
                  return reject(new Error(util.format('Cannot trigger manual ' +
                    'build for project id: %s, err: %s, %s', projectId, err,
                    response)));

                return resolve(response);
              }
            );
          }
        );
        triggerBuild.then(
          function (response) {
            runId = response.runId;

            var expBackoff = backoff.exponential({
              initialDelay: 100, // ms
              maxDelay: 1000 // max retry interval of 1 second
            });
            expBackoff.failAfter(30); // fail after 30 attempts
            expBackoff.on('backoff',
              function (number, delay) {
                logger.info('Run with id:', runId, ' not yet in processing. ' +
                  'Retrying after ', delay, ' ms');
              }
            );

            expBackoff.on('ready',
              function () {
                global.ghcAdminAdapter.getRunById(runId,
                  function (err, run) {
                    if (err)
                      return done(new Error('Failed to get run id: %s, err:',
                        runId, err));

                    var processingStatusCode = _.findWhere(global.systemCodes,
                      {group: 'statusCodes', name: 'PROCESSING'}).code;
                    if (run.statusCode !== processingStatusCode) {
                      expBackoff.backoff();
                    } else {
                      expBackoff.reset();
                      return done();
                    }
                  }
                );
              }
            );

            // max number of backoffs reached
            expBackoff.on('fail',
              function () {
                return done(new Error('Max number of backoffs reached'));
              }
            );

            expBackoff.backoff();
          },
          function (err) {
            return done(err);
          }
        );
      }
    );

    it('6. Can view builds',
      function (done) {
        var query = util.format('projectIds=%s', projectId);
        global.ghcAdminAdapter.getRuns(query,
          function (err, builds) {
            if (err)
              return done(new Error(util.format('Cannot get builds for ' +
                'project id: %s, err: %s', projectId, err)));
            // check if build triggered in previous test case is present
            assert.strictEqual(_.contains(_.pluck(builds, 'id'), runId), true);
            return done();
          }
        );
      }
    );

    it('7. Can view consoles',
      function (done) {
        var bag = {
          runId: runId,
          logs: []
        };
        async.series([
          getJobs.bind(null, bag),
          getLogs.bind(null, bag)
        ],
          function (err) {
            assert.isNotEmpty(bag.logs, 'logs not found');
            return done(err);
          }
        );
      }
    );

    function getJobs(bag, next) {
      var query = util.format('runIds=%s', bag.runId);
      global.ghcAdminAdapter.getJobs(query,
        function (err, response) {
          if (err || _.isEmpty(response))
            return next(new Error(util.format('Cannot find jobs for run' +
              ' id: %s, err: %s', bag.runId, err)));
          bag.jobId = _.first(_.pluck(response, 'id'));
          return next();
        }
      );
    }

    function getLogs(bag, next) {
      global.ghcAdminAdapter.getJobConsolesByJobId(bag.jobId, '',
        function (err, response) {
          if (err)
            return next(new Error(util.format('Cannot get consoles for ' +
              'job id: %s, err: %s', bag.jobId, err)));
          bag.logs = response;
          return next();
        }
      );
    }

    it('8. Can cancel build',
      function (done) {
        global.ghcAdminAdapter.cancelRunById(runId,
          function (err, response) {
            if (err)
              return done(new Error(util.format('Cannot cancel build id: %d ' +
                'for project id: %s, err: %s, %s', runId, projectId, err,
                response)));
            return done();
          }
        );
      }
    );

    it('9. Can run custom build',
      function (done) {
        var json = {branchName: 'master', globalEnv: {key: 'value'}};
        global.ghcAdminAdapter.triggerNewBuildByProjectId(projectId, json,
          function (err, response) {
            if (err)
              return done(new Error(util.format('Cannot trigger custom build ' +
                'for project id: %s, err: %s, %s', projectId, err, response)));
            return done();
          }
        );
      }
    );

    it('13. Can rerun build',
      function (done) {
        var json = {runId: runId};
        global.ghcAdminAdapter.triggerNewBuildByProjectId(projectId, json,
          function (err, response) {
            if (err)
              return done(
                new Error(util.format('Admin cannot rerun a build' +
                  'for project id: %s, body: %s err: %s, %s', projectId, json,
                  err, util.inspect(response))
                )
              );
            return done();
          }
        );
      }
    );


    it('10. Can reset cache',
      function (done) {
        var json = {
          propertyBag: {
            cacheTag: 0,
            cacheResetDate: Date.now()
          }
        };
        global.ghcAdminAdapter.putProjectById(projectId, json,
          function (err, response) {
            if (err)
              return done(new Error(util.format('Cannot reset cache project ' +
                'id: %s, err: %s, %s', projectId, err, response)));
            return done();
          }
        );
      }
    );

    it('11. Can Reset a public project',
      function (done) {
        var json = {projectId: projectId};
        global.ghcAdminAdapter.resetProjectById(projectId, json,
          function (err, response) {
            if (err)
              return done(new Error(util.format('Cannot reset project id: %s' +
                ', err: %s, %s', projectId, err, response)));
            return done();
          }
        );
      }
    );

    it('12. Can Delete a public project',
      function (done) {
        var json = {projectId: projectId};
        global.ghcAdminAdapter.deleteProjectById(projectId, json,
          function (err, response) {
            if (err)
              return done(new Error(util.format('Cannot delete project id: %s' +
                ', err: %s, %s', projectId, err, response)));
            global.removeResource(
              {
                type: 'project',
                id: projectId
              },
              function () {
                projectId = null;
                return done();
              }
            );
          }
        );
      }
    );

    after(
      function (done) {
        if (projectId)
          global.suAdapter.deleteProjectById(projectId, {},
            function (err, response) {
              if (err) {
                logger.warn(testSuite,
                  util.format('Cleanup-failed to delete the project with id:' +
                    '%s, err: %s, %s', projectId, err, util.inspect(response)
                  )
                );
                return done();
              }
              global.removeResource(
                {
                  type: 'project',
                  id: projectId
                },
                function () {
                  return done();
                }
              );
            }
          );
        else
          return done();
      }
    );
  }
);
