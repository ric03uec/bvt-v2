'use strict';

var setupTests = require('../../_common/setupTests.js');
var backoff = require('backoff');

var testSuite = 'ACCT-GHC-MEM-IND';
var testSuiteDesc = ' - TestSuite for Individual Github Member for login';

describe(testSuite + testSuiteDesc,
  function () {
    var account = {};
    var githubSysIntId = null;
    var subscriptions = null;
    this.timeout(0);

    before(
      function (done) {
        setupTests().then(
          function () {
            var query = 'masterName=githubKeys&name=auth';
            global.suAdapter.getSystemIntegrations(query,
              function (err, systemIntegrations) {
                if (err) {
                  assert.isNotOk(err, 'get Github sysInt failed with err');
                  return done(true);
                }

                var gitSysInt = _.first(systemIntegrations);
                assert.isOk(gitSysInt, 'No sysInt found for github');
                assert.isOk(gitSysInt.id, 'Github sysIntId should be present');
                githubSysIntId = gitSysInt.id;
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

    it('1. Login should generate API token',
      function (done) {
        var json = {
          accessToken: global.githubMemberAccessToken
        };
        global.pubAdapter.postAuth(githubSysIntId, json,
          function (err, body, res) {
            assert.isNotEmpty(res, 'Result should not be empty');
            assert.strictEqual(res.statusCode, 200, 'statusCode should be 200');
            assert.isNotEmpty(body, 'body should not be null');
            assert.isNotNull(body.apiToken, 'API token should not be null');

            account.githubMemberApiToken = body.apiToken;
            account.memberId = body.account.id;
            global.setupGithubMemberAdapter(body.apiToken);

            return done(err);
          }
        );
      }
    );

    it('2. Login account should finish syncing',
      function () {
        var accountSynced = new Promise(
          function (resolve, reject) {
            var expBackoff = backoff.exponential({
              initialDelay: 100, // ms
              maxDelay: 5000 // max retry interval of 5 seconds
            });
            expBackoff.failAfter(30); // fail after 30 attempts
            expBackoff.on('backoff',
              function (number, delay) {
                logger.info('Account syncing. Retrying after ', delay, ' ms');
              }
            );

            expBackoff.on('ready',
              function () {
                // set account when ready
                var query = util.format('accountIds=%s', account.memberId);
                global.suAdapter.getAccounts(query,
                  function (err, accounts) {
                    if (err)
                      return reject(new Error('Failed to get account with err',
                        err));

                    var acc = _.first(accounts);
                    if (acc.isSyncing !== false ||
                      !acc.lastSyncStartDate) {
                      expBackoff.backoff();
                    } else {
                      expBackoff.reset();
                      return resolve(acc);
                    }
                  }
                );
              }
            );

            // max number of backoffs reached
            expBackoff.on('fail',
              function () {
                return reject(new Error('Max number of backoffs reached'));
              }
            );

            expBackoff.backoff();
          }
        );
        return accountSynced.then(
          function (acc) {
            assert.isNotEmpty(acc, 'account should not be empty');
          }
        );
      }
    );

    it('3. Login - should sync projects',
      function () {
        var getProjects = new Promise(
          function (resolve, reject) {
            global.ghcMemberAdapter.getProjects('',
              function (err, projects) {
                if (err)
                  return reject(new Error('Unable to get projects with error',
                    err));
                return resolve(projects);
              }
            );
          }
        );
        return getProjects.then(
          function (projects) {
            // TODO : check if a list of projects be checked to make the
            //        test more narrow. should also run locally
            assert.isNotEmpty(projects, 'Projects should not be empty');
          }
        );
      }
    );

    it('4. Login - should create subscriptions',
      function () {
        var getSubs = new Promise(
          function (resolve, reject) {
            global.ghcMemberAdapter.getSubscriptions('',
              function (err, subs) {
                if (err)
                  return reject(new Error('Unable to get subs with error',
                    err));
                return resolve(subs);
              }
            );
          }
        );
        return getSubs.then(
          function (subs) {
            // TODO : check if a list of subscriptions be checked to make the
            //        test more narrow. should also run locally
            subscriptions = subs;
            assert.isNotEmpty(subs, 'Subscriptions should not be empty');
          }
        );
      }
    );

    it('5. A user with repository pull permission is a member for the ' +
      'project',
      function (done) {
        var currentSub =
          _.findWhere(subscriptions, {orgName: global.GHC_OWNER_NAME});
        assert.isNotEmpty(currentSub,
          'Current subscription should not be empty');
        var query = util.format('subscriptionIds=%s', currentSub.id);
        global.ghcMemberAdapter.getProjectAccounts(query,
          function (err, projectAccounts) {
            assert(!err, util.format('Unable to get project Accounts with ' +
              'error %s', err));
            assert.isNotEmpty(projectAccounts,
              'SubscriptionAccounts should not be empty');
            var collabSystemCode = _.findWhere(global.systemCodes,
              {name: 'collaborator', group: 'roles'}).code;
            var memSystemCode = _.findWhere(global.systemCodes,
              {name: 'member', group: 'roles'}).code;
            var adminSystemCode = _.findWhere(global.systemCodes,
              {name: 'admin', group: 'roles'}).code;
            assert.isNotEmpty(_.where(projectAccounts,
              {roleCode: memSystemCode}), 'User with pull permission is ' +
              'not having member');
            assert.isEmpty(_.where(projectAccounts,
              {roleCode: adminSystemCode}), 'User with pull permission is ' +
              'having admin role');
            assert.isEmpty(_.where(projectAccounts,
              {roleCode: collabSystemCode}), 'User with pull permission is ' +
              'having collab role');
            return done();
          }
        );
      }
    );

    after(
      function (done) {
        // save account id and apiToken
        global.saveResource(
          {
            type: 'account',
            id: account.memberId,
            apiToken: account.githubMemberApiToken,
            role: 'member'
          },
          function () {
            return done();
          }
        );
      }
    );
  }
);
