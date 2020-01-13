import * as _ from 'lodash'

// We need this dedicated function as a wrapper- otherwise we would get errors
// when we have multiple typed calls within one typescript file. The checker then does not realize that
// _.cloneDeep is type agnostic
export const cloneDeep = <T>(arg: T): T => {
    return _.cloneDeep(arg)
}
